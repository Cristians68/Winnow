import type { ReviewSignal, ProductSnapshot } from '../types.js';
import { trigrams, jaccard, wordCount, clamp } from '../text.js';

/** Above this character-trigram Jaccard, two reviews are effectively the same text. */
const NEAR_DUPLICATE_THRESHOLD = 0.55;

/**
 * Near-duplicate detection across the visible sample.
 *
 * Review farms work from templates and lightly paraphrase, so character-level
 * shingles catch them where word-level comparison misses. Both members of a
 * duplicate pair are penalised: we cannot tell which one was the original, and
 * in practice neither usually is.
 */
export const duplicationSignal: ReviewSignal = {
  id: 'duplication',
  label: 'Duplicate text',

  evaluate(snapshot: ProductSnapshot) {
    const out = new Map<string, { delta: number; reason: string }>();

    // Very short reviews trivially collide ("Great product!"), which would
    // produce false positives, so they are excluded here — the depth signal
    // handles them instead.
    const candidates = snapshot.reviews.filter((r) => wordCount(r.text ?? '') >= 12);
    if (candidates.length < 2) return out;

    const grams = new Map(candidates.map((r) => [r.id, trigrams(r.text)]));
    const matchCounts = new Map<string, number>();
    const peaks = new Map<string, number>();

    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i]!;
        const b = candidates[j]!;
        const similarity = jaccard(grams.get(a.id)!, grams.get(b.id)!);
        if (similarity < NEAR_DUPLICATE_THRESHOLD) continue;

        for (const id of [a.id, b.id]) {
          matchCounts.set(id, (matchCounts.get(id) ?? 0) + 1);
          peaks.set(id, Math.max(peaks.get(id) ?? 0, similarity));
        }
      }
    }

    for (const [id, count] of matchCounts) {
      const peak = peaks.get(id) ?? NEAR_DUPLICATE_THRESHOLD;
      // Scale with both how similar and how many others it matched.
      const delta = clamp(0.35 * peak + 0.15 * Math.min(count, 3));
      out.set(id, {
        delta,
        reason:
          count === 1
            ? 'Text closely matches another review on this product'
            : `Text closely matches ${count} other reviews on this product`,
      });
    }

    return out;
  },
};
