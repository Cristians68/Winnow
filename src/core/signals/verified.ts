import type { ReviewSignal, ProductSnapshot } from '../types.js';

/**
 * Unverified-purchase weighting.
 *
 * Following ReviewMeta's stated approach: a "Verified Purchase" badge does not
 * *boost* a review — it only protects it from being devalued here. Plenty of
 * honest reviews are unverified (gifts, guest checkout), so this is a moderate
 * nudge rather than a disqualification, and it is deliberately harsher when the
 * unverified review is also a 5-star rating.
 */
export const verifiedSignal: ReviewSignal = {
  id: 'verified',
  label: 'Verified purchases',

  evaluate(snapshot: ProductSnapshot) {
    const out = new Map<string, { delta: number; reason: string }>();

    for (const review of snapshot.reviews) {
      if (review.verified) continue;

      const delta = review.rating === 5 ? 0.3 : 0.18;
      out.set(review.id, {
        delta,
        reason:
          review.rating === 5
            ? 'Unverified purchase giving a 5-star rating'
            : 'Unverified purchase',
      });
    }

    return out;
  },
};
