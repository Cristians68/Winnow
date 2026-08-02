import type { ReviewSignal, ProductSnapshot } from '../types.js';

const DAY_MS = 86_400_000;
const AGE_THRESHOLD_DAYS = 90;

/**
 * Ratings a listing needs before "nobody voted" means anything.
 *
 * This was 200, and 200 is far too low. Seen on a live listing: a perfectly
 * ordinary camera lens with 234 ratings, 76% five-star and a healthy 4% one-star
 * tail, where this check flagged four of thirteen reviews for having no helpful
 * votes after a year. On a listing that size almost nothing gets voted on — the
 * traffic simply is not there — so the absence of votes carried no information
 * and the panel showed a CAUTION row anyway.
 *
 * That matters more than the arithmetic suggests. The check's delta is small
 * and the grade never moved, but a caution badge reads to a shopper as an
 * accusation, and crying wolf on ordinary listings is the failure that destroys
 * trust in a tool like this fastest. The signal's own premise — that Amazon
 * features reviews partly by helpfulness, so a featured review nobody has ever
 * voted on is odd — only holds where voting actually happens.
 */
const MIN_RATINGS_FOR_VOTE_SIGNAL = 1_000;

/**
 * Helpful-vote absence.
 *
 * This signal exploits a quirk of what we can see: Amazon surfaces *featured*
 * reviews on the product page, and featured placement is itself partly driven by
 * helpfulness. So a review that Amazon chose to feature, which is months old and
 * has still never been marked helpful by anyone, is genuinely odd.
 *
 * The bias cuts both ways though — vote counts are noisy and low-traffic
 * products accumulate few votes regardless of authenticity. Weighted lightly on
 * purpose.
 */
export const helpfulnessSignal: ReviewSignal = {
  id: 'helpfulness',
  label: 'Community response',

  evaluate(snapshot: ProductSnapshot) {
    const out = new Map<string, { delta: number; reason: string }>();

    // Only meaningful if the product has enough traffic for votes to accrue.
    if ((snapshot.totalRatings ?? 0) < MIN_RATINGS_FOR_VOTE_SIGNAL) return out;

    const now = Date.now();

    for (const review of snapshot.reviews) {
      if (!review.date) continue;
      if (review.helpfulVotes > 0) continue;
      if (review.rating !== 5) continue;

      const time = Date.parse(review.date);
      if (!Number.isFinite(time)) continue;

      const ageDays = (now - time) / DAY_MS;
      if (ageDays < AGE_THRESHOLD_DAYS) continue;

      out.set(review.id, {
        delta: 0.12,
        reason: `Featured on the product page for ${Math.round(ageDays)} days without a single helpful vote`,
      });
    }

    return out;
  },
};
