/**
 * Turning a third party's JSON into something Winnow is willing to render.
 *
 * Treat everything arriving here as hostile. It is remote text controlled by
 * an advertiser and shaped by a network, and it is about to be placed inside a
 * privileged extension page. The rule this module enforces is the one the
 * Amazon parser learned the hard way, twice: a partial parse is worse than no
 * parse. A creative missing its advertiser name is an ad whose payer is
 * hidden, which is a worse outcome than an empty slot — so every validation
 * failure discards the entire creative rather than repairing it.
 */

import { isAllowedCreativeUrl, networkFor } from './registry.js';
import { ACCEPTED_FORMATS, buildAdRequest } from './policy.js';
import type { AdCreative, AdNetwork, AdProviderId, AdSlot } from './types.js';

/**
 * Length caps.
 *
 * These are layout limits, not security limits — but an unbounded headline is
 * a way to push Winnow's own UI off screen, so they are enforced by rejection
 * rather than by truncation. Truncating would let a network ship a creative
 * that reads differently than it was approved to read.
 */
export const MAX_HEADLINE = 80;
export const MAX_BODY = 140;
export const MAX_ADVERTISER = 40;

/**
 * Response fields that mean the network is trying to hand us behaviour rather
 * than content. Their presence rejects the whole creative — see the note in
 * normaliseCreative for why ignoring them is not good enough.
 */
export const BEHAVIOUR_FIELDS: readonly string[] = [
  'html',
  'script',
  'js',
  'javascript',
  'iframe',
  'embed',
  'onclick',
  'onload',
  'onerror',
  'srcdoc',
];

/** A string field that must be present, plain, and within its cap. */
function text(value: unknown, max: number): string | null {
  // Explicitly typeof, not truthiness: a number, an array or an object with a
  // toString would otherwise be coerced into something renderable.
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return null;
  return trimmed;
}

/** An optional URL field: absent is fine, present-but-hostile is not. */
function optionalUrl(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined; // undefined signals "reject"
  return isAllowedCreativeUrl(value) ? value : undefined;
}

/**
 * Validate one decoded ad response into a creative, or reject it outright.
 *
 * Returns null rather than throwing: a malformed ad is an ordinary condition,
 * not an error worth interrupting the popup for.
 */
export function normaliseCreative(provider: AdProviderId, raw: unknown): AdCreative | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;

  // Reject outright, rather than ignore, any field that offers behaviour.
  //
  // Building the creative field by field already stops these from rendering,
  // so this looks redundant — it is not. Ignoring them silently means the day
  // someone refactors this function into a spread of `source`, the extension
  // starts rendering advertiser-supplied HTML and every test still passes. A
  // network sending these has a contract that does not match ours, and the
  // useful time to find that out is now, loudly, not after a refactor.
  //
  // Unknown *benign* fields are still ignored: networks add optional fields
  // over time and breaking every install over one would be its own bug.
  if (BEHAVIOUR_FIELDS.some((field) => field in source)) return null;

  const headline = text(source.headline, MAX_HEADLINE);
  const advertiser = text(source.advertiser, MAX_ADVERTISER);
  // Body is the one genuinely optional string; an empty one renders as no line.
  //
  // null counts as absent, matching imageUrl and viewUrl. A sponsor file
  // author writing "body": null is following the pattern of the rest of the
  // file, and rejecting the creative over it would lose the ad silently —
  // an empty slot reads as "no sponsor available", so nothing would ever
  // report the mistake. A body that is present but not text is still a
  // rejection: that means the network sent something we do not understand.
  const absent = source.body === undefined || source.body === null || source.body === '';
  const body = absent ? '' : text(source.body, MAX_BODY);

  if (!headline || !advertiser || body === null) return null;

  const clickUrl = typeof source.clickUrl === 'string' && isAllowedCreativeUrl(source.clickUrl)
    ? source.clickUrl
    : null;
  if (!clickUrl) return null;

  const imageUrl = optionalUrl(source.imageUrl);
  const viewUrl = optionalUrl(source.viewUrl);
  if (imageUrl === undefined || viewUrl === undefined) return null;

  // Built field by field, so no unexpected key — `html`, a tracking blob, a
  // nested object — can ride along on a spread of the source.
  return { provider, headline, body, advertiser, clickUrl, imageUrl, viewUrl };
}

/**
 * Pick a creative from whatever a network returned.
 *
 * A self-hosted sponsor file is the rail that can earn without anybody's
 * approval, and one that holds a single sponsor is one you must redeploy to
 * rotate. Accepting a list and choosing here keeps the host a static document:
 * no server, no request logs, nothing running.
 *
 * Choosing client-side is also the privacy-preserving option. A server that
 * rotated for us would need to see each request to do it, and the entire point
 * of this design is that nothing observes the slot being filled.
 *
 * `random` is injectable so the tests can pin the choice; production passes
 * Math.random.
 */
export function selectCreative(
  provider: AdProviderId,
  raw: unknown,
  random: () => number = Math.random,
): AdCreative | null {
  if (!Array.isArray(raw)) return normaliseCreative(provider, raw);
  if (raw.length === 0) return null;

  // Clamped rather than trusted. Math.random() is documented as < 1, but an
  // out-of-range index would yield undefined, normalise to null, and look
  // exactly like "no sponsor available" — a silent failure in the one place
  // revenue actually comes from.
  const index = Math.min(raw.length - 1, Math.max(0, Math.floor(random() * raw.length)));

  // Try the chosen entry, then the rest in order. One malformed sponsor must
  // not take the whole file down with it, but a malformed one is still never
  // rendered — normaliseCreative decides that, not this function.
  for (let offset = 0; offset < raw.length; offset += 1) {
    const creative = normaliseCreative(provider, raw[(index + offset) % raw.length]);
    if (creative) return creative;
  }
  return null;
}

/**
 * Where to send a decision request.
 *
 * For a GET network the request *is* the URL, so the slot and the network's
 * fixed parameters go in the query string. Nothing install-specific is added:
 * the parameters come from the registry and the slot name is one of two
 * constants, so two installations still produce byte-identical URLs and the
 * request cannot become a fingerprint.
 */
export function decisionUrl(network: AdNetwork, slot?: AdSlot): string {
  const base = `${network.origin}${network.path}`;
  if (slot === undefined) return base;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(network.params)) query.set(key, value);
  query.set('slot', slot);
  query.set('formats', ACCEPTED_FORMATS.join(','));
  return `${base}?${query.toString()}`;
}

/** The request body for a slot. Page data cannot reach here; see policy.ts. */
export function decisionBody(slot: AdSlot): string {
  return JSON.stringify(buildAdRequest(slot));
}

/** Look up a provider's network, or null if it is not configured. */
export function providerFor(id: AdProviderId): AdNetwork | null {
  return networkFor(id);
}
