import type { ReviewSignal, ProductSnapshot } from '../types.js';
import { DISCOUNT_THRESHOLD } from '../score.js';

/**
 * Unverified-purchase weighting.
 *
 * Following ReviewMeta's stated approach: a "Verified Purchase" badge does not
 * *boost* a review — it only protects it from being devalued here. Plenty of
 * honest reviews are unverified (gifts, guest checkout), so this is a moderate
 * nudge rather than a disqualification, and it is deliberately harsher when the
 * unverified review is also a 5-star rating.
 *
 * An unverified 5-star review sits exactly *at* the discount threshold, so one
 * counts as discounted on its own. This was found by live testing: at 0.30 it
 * fell just under the bar, so a listing where seven of eight visible reviews
 * were unverified five-star ratings still graded A and reported "nothing
 * flagged", while the breakdown directly beneath it read FLAGGED. Nothing about
 * that listing was subtle; the number was simply set below the only threshold
 * that acts on it.
 *
 * Isolated cases stay harmless, because the grade cap keys off the *share* of
 * discounted reviews and does not engage until 15%: one unverified five-star
 * among thirteen still grades normally. It is the concentration that matters.
 */
export const verifiedSignal: ReviewSignal = {
  id: 'verified',
  label: 'Verified purchases',

  evaluate(snapshot: ProductSnapshot) {
    const out = new Map<string, { delta: number; reason: string }>();

    for (const review of snapshot.reviews) {
      if (review.verified) continue;

      const delta = review.rating === 5 ? DISCOUNT_THRESHOLD : 0.18;
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
