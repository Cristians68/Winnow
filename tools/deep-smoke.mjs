/**
 * End-to-end smoke test for deep analysis.
 *
 * The unit suites cover the client contract and the server signals separately,
 * with the network in between replaced by a function call. This exercises the
 * real path: the real `buildRequest` from the extension, over real HTTP, through
 * the real sanitiser, into the real corpus, and back through `toAugmentation`.
 *
 * It exists because the seam is where the interesting failures live — a field
 * the client sends that the server rejects, a CORS rule that blocks the
 * extension itself, a privacy leak that only appears in the serialised body.
 *
 * Usage:
 *   cd server && npm start           # in one terminal
 *   node tools/deep-smoke.mjs        # in another
 *
 * Point it elsewhere with WINNOW_ENDPOINT. Run it against a scratch database
 * (WINNOW_DB=/tmp/smoke.db npm start) — it writes real observations.
 */

import { buildRequest, toAugmentation } from '../src/shared/deep.ts';

const ENDPOINT = process.env.WINNOW_ENDPOINT ?? 'http://127.0.0.1:8787/v1/analyse';
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

let failures = 0;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures++;
};

async function post(snapshot, { origin = ORIGIN } = {}) {
  const body = await buildRequest(snapshot);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body, json: await res.json().catch(() => null) };
}

/** A plausible listing. `text` is shared across reviews so callers can seed templates. */
function snapshot(asin, text, extra = {}) {
  return {
    asin,
    title: `Product ${asin}`,
    displayedRating: 4.7,
    totalRatings: 3000,
    histogram: { 5: 88, 4: 6, 3: 2, 2: 1, 1: 3 },
    reviews: Array.from({ length: 8 }, (_, i) => ({
      id: `${asin}-R${i}`,
      rating: 5,
      date: `2026-0${(i % 6) + 1}-1${i % 9}`,
      verified: true,
      text: `${text} Review number ${i}.`,
      helpfulVotes: 0,
      // Distinct reviewers per product by default, so the network signal does
      // not fire and confound whatever this run is actually measuring.
      reviewerId: `${asin}-reviewer-${i}`,
      // Deliberately present, and deliberately expected never to be transmitted.
      author: 'Real Reviewer Name',
    })),
    ...extra,
  };
}

console.log(`\nWinnow deep-analysis smoke test → ${ENDPOINT}\n`);

// --- reachability ----------------------------------------------------------
const health = await fetch(ENDPOINT.replace(/\/v1\/analyse$/, '/health')).catch(() => null);
if (!health?.ok) {
  console.error('Server is not reachable. Start it with:  cd server && npm start');
  process.exit(1);
}
check('health endpoint responds', true);

// --- the privacy guarantee, on the actual wire format ----------------------
const first = await post(snapshot('B0SMOKE001', 'A perfectly ordinary review of a perfectly ordinary product.'));
check('analyse returns 200', first.status === 200, `got ${first.status}`);
check(
  'reviewer display names never leave the browser',
  !JSON.stringify(first.body).includes('Real Reviewer Name'),
);
check(
  'payload carries only contract fields',
  Object.keys(first.body.reviews[0]).sort().join(',') ===
    'date,helpfulVotes,id,rating,reviewerId,text,verified',
  Object.keys(first.body.reviews[0]).join(','),
);
check('product title is sent only as a hash', typeof first.body.titleHash === 'string' && !JSON.stringify(first.body).includes('Product B0SMOKE001'));

// --- input validation is enforced server-side ------------------------------
const badAsin = await post({ ...snapshot('B0SMOKE002', 'text'), asin: 'TOO-LONG-ASIN' });
check('malformed ASIN is rejected', badAsin.status === 400, badAsin.json?.error);

const unknownField = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: ORIGIN },
  body: JSON.stringify({ ...(await buildRequest(snapshot('B0SMOKE003', 'x'))), userEmail: 'a@b.c' }),
});
check('unknown fields are rejected rather than ignored', unknownField.status === 400);

// --- CORS: only the extension may call this --------------------------------
const webOrigin = await post(snapshot('B0SMOKE004', 'text'), { origin: 'https://example.com' });
check('a web page origin is refused', webOrigin.status === 403, `got ${webOrigin.status}`);

// --- caching ---------------------------------------------------------------
const repeat = await post(snapshot('B0SMOKE001', 'A perfectly ordinary review of a perfectly ordinary product.'));
check('a repeat request is served from cache', repeat.json?.cached === true);

// --- the response actually drives the local engine -------------------------
const augmentation = toAugmentation(first.json);
check('response converts to a local augmentation', Array.isArray(augmentation.signals) && augmentation.signals.length > 0);
check(
  'insufficient-data findings carry zero confidence',
  augmentation.signals.filter((s) => s.status === 'insufficient-data').every((s) => s.confidence === 0),
);

// --- the reviewer-network signal ------------------------------------------
// The same handful of reviewers across several unrelated products is the
// pattern a paid-review ring leaves behind.
const ring = (asin) => ({
  ...snapshot(asin, 'Great product, exactly as described, would buy again from this seller.'),
  reviews: snapshot(asin, 'Great product, exactly as described, would buy again from this seller.').reviews.map(
    (r, i) => ({ ...r, reviewerId: `ring-member-${i}` }),
  ),
});
for (const asin of ['B0RING0001', 'B0RING0002', 'B0RING0003', 'B0RING0004']) await post(ring(asin));
const ringResult = await post(ring('B0RING0009'));
const networkFinding = ringResult.json?.productFindings?.find((f) => f.id === 'reviewer-network');
check('a shared reviewer ring is detected', networkFinding?.status === 'fail', `status ${networkFinding?.status}`);

// --- what this run cannot prove -------------------------------------------
// Cross-product template reuse needs a phrase corroborated across two calendar
// days, so a single-day run can never exercise it end to end. That behaviour is
// pinned in server/tests/signals.test.ts, where the clock is injectable.
console.log('\n  note  cross-product template reuse is day-gated and is covered by unit tests, not here.');

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
