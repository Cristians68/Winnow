/**
 * HTTP layer.
 *
 * Security posture, in order of importance to this product:
 *
 *  · **No request logging.** Not IPs, not ASINs, not bodies. A log correlating
 *    an address with a product would recreate exactly the browsing history the
 *    privacy policy promises does not exist. Rate limiting holds addresses in
 *    memory only, hashed, and forgets them on a timer.
 *  · **Strict input handling.** Body size capped before parsing, JSON depth
 *    bounded, every field allowlisted (privacy.ts), all SQL parameterised.
 *  · **Locked-down CORS.** Only the extension origin may call the API.
 *  · **Defensive headers** and no error detail leakage to clients.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Corpus } from './db.ts';
import { LIMITS, RejectedRequest, sanitiseRequest, SALT_IS_EPHEMERAL, saltFingerprint } from './privacy.ts';
import { runDeepAnalysis } from './deep.ts';

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 60 } as const;

/**
 * In-memory only, keyed by a hash of the address, cleared on a timer.
 * Never written to disk and never associated with request content.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, RATE_LIMIT.windowMs).unref();

function rateLimitKey(req: IncomingMessage): string {
  // Trust a proxy header only when explicitly configured to.
  const forwarded = process.env.WINNOW_TRUST_PROXY === '1' ? req.headers['x-forwarded-for'] : undefined;
  const raw = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
  return createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

function checkRateLimit(req: IncomingMessage): boolean {
  const key = rateLimitKey(req);
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return true;
  }
  bucket.count++;
  return bucket.count <= RATE_LIMIT.maxRequests;
}

function securityHeaders(res: ServerResponse, origin: string | undefined): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Permissions-Policy', 'interest-cohort=()');

  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

/** Only the extension may call this API. Extension ids are pinned via env. */
export function isAllowedOrigin(origin: string): boolean {
  const allowed = (process.env.WINNOW_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (allowed.length === 0) {
    // Default-safe: any chrome/moz extension origin, but never a web page.
    return /^(chrome-extension|moz-extension):\/\/[a-z0-9]+$/i.test(origin);
  }

  return allowed.some((candidate) => {
    if (candidate.length !== origin.length) return false;
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(origin));
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > LIMITS.maxBodyBytes) throw new RejectedRequest('request body too large');

  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > LIMITS.maxBodyBytes) {
        reject(new RejectedRequest('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => reject(new RejectedRequest('request stream error')));
  });
}

export function createApp(corpus: Corpus) {
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    securityHeaders(res, origin);

    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(origin && isAllowedOrigin(origin) ? 204 : 403).end();
        return;
      }

      if (req.url === '/health' && req.method === 'GET') {
        send(res, 200, { status: 'ok' });
        return;
      }

      if (req.url !== '/v1/analyse' || req.method !== 'POST') {
        send(res, 404, { error: 'not found' });
        return;
      }

      if (origin !== undefined && !isAllowedOrigin(origin)) {
        send(res, 403, { error: 'origin not allowed' });
        return;
      }

      if (!checkRateLimit(req)) {
        res.setHeader('Retry-After', String(RATE_LIMIT.windowMs / 1000));
        send(res, 429, { error: 'rate limit exceeded' });
        return;
      }

      const contentType = req.headers['content-type'] ?? '';
      if (!contentType.includes('application/json')) {
        send(res, 415, { error: 'content-type must be application/json' });
        return;
      }

      const raw = await readBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        send(res, 400, { error: 'malformed JSON' });
        return;
      }

      const request = sanitiseRequest(parsed);
      send(res, 200, runDeepAnalysis(request, corpus));
    } catch (error) {
      if (error instanceof RejectedRequest) {
        // Validation reasons are safe to return: they describe the caller's own
        // payload shape and reveal nothing about the server or other users.
        send(res, 400, { error: error.reason });
        return;
      }
      // Everything else is opaque to the client by design.
      console.error('[winnow] internal error:', error instanceof Error ? error.message : 'unknown');
      send(res, 500, { error: 'internal error' });
    }
  });
}

/**
 * Report, at boot, anything about the reviewer-id salt that would quietly
 * disable the reviewer-network signal.
 *
 * Both cases below leave a server that starts cleanly, answers requests, and
 * reports that reviewers look unconnected — which is exactly what it would say
 * about a genuinely clean product. Silence here would mean shipping a blind
 * signal that looks like a working one.
 */
function warnAboutSalt(corpus: Corpus): void {
  if (SALT_IS_EPHEMERAL) {
    console.warn(
      '[winnow] WINNOW_HASH_SALT is not set — using a random per-process salt. Reviewer hashes will ' +
        'not match anything stored by a previous run, so the reviewer-network signal starts blind. ' +
        'Fine for local development; set it from a secret manager in production.',
    );
  }

  const drift = corpus.checkSaltFingerprint(saltFingerprint());
  if (drift?.changed) {
    console.error(
      `[winnow] the reviewer-id salt has CHANGED since this corpus was last written. ` +
        `${drift.orphanedReviewers.toLocaleString()} stored reviewer hashes can no longer be matched, ` +
        'so cross-product reviewer overlap will not be detected for them. Restore the previous ' +
        'WINNOW_HASH_SALT, or accept that the reviewer-network signal is rebuilding from zero.',
    );
  }
}

/** How often the retention sweep runs. Daily is ample for a 24-month policy. */
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startServer(port = Number(process.env.PORT ?? 8787)): ReturnType<typeof createApp> {
  const corpus = new Corpus();
  const server = createApp(corpus);

  warnAboutSalt(corpus);

  // Enforce the retention promise in PRIVACY.md. Run once at boot so a restart
  // after downtime catches up, then daily.
  const sweep = () => {
    try {
      const removed = corpus.pruneExpired();
      if (removed.reviews || removed.observations || removed.cache) {
        // Counts only — naming the products would be the logging we promise not to do.
        console.log(
          `[winnow] retention sweep: removed ${removed.reviews} reviews, ${removed.observations} observations, ${removed.cache} cached analyses`,
        );
      }
    } catch (error) {
      console.error('[winnow] retention sweep failed:', error instanceof Error ? error.message : 'unknown');
    }
  };
  sweep();
  setInterval(sweep, RETENTION_INTERVAL_MS).unref();
  server.headersTimeout = 10_000;
  server.requestTimeout = 20_000;
  server.listen(port, () => {
    console.log(`[winnow] deep-analysis server on :${port} — request logging is intentionally disabled`);
  });
  return server;
}
