import type { ReviewSignal, ProductSnapshot } from '../types.js';
import { wordCount, specificityMarkers, clamp } from '../text.js';

/**
 * Content depth.
 *
 * Someone motivated enough to rate a product at either extreme usually has
 * something to say about why. A wall of 5-star ratings carrying six words of
 * generic praise is one of the oldest manipulation patterns there is.
 *
 * Short reviews are not inherently fake — plenty of real people write "works
 * great" — so this stays a modest penalty and eases off when the review
 * contains concrete specifics.
 */
export const depthSignal: ReviewSignal = {
  id: 'depth',
  label: 'Review substance',

  evaluate(snapshot: ProductSnapshot) {
    const out = new Map<string, { delta: number; reason: string }>();

    for (const review of snapshot.reviews) {
      const words = wordCount(review.text ?? '');
      const isExtreme = review.rating === 5 || review.rating === 1;
      if (!isExtreme || words >= 15) continue;

      // Concrete detail redeems brevity: "died after 3 weeks" is short but real.
      if (specificityMarkers(review.text ?? '') > 0) continue;

      const severity = clamp((15 - words) / 15);
      const delta = clamp(0.22 * severity);

      out.set(review.id, {
        delta,
        reason:
          words === 0
            ? `${review.rating}-star rating with no written review`
            : `${review.rating}-star rating with only ${words} ${words === 1 ? 'word' : 'words'} and no specifics`,
      });
    }

    return out;
  },
};
