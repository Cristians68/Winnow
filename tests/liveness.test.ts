/**
 * Signal liveness.
 *
 * Every other suite asks "does this signal give the right answer on this
 * input?". These ask a blunter question: **can this signal fire at all?**
 *
 * That question earned its own file. Cross-product template reuse — the
 * strongest signal in the deep-analysis server — shipped in a state where it
 * could never fire in normal use, because the corroboration rule required a
 * condition that organic traffic almost never produces. Every existing test
 * passed, because every existing test happened to construct that condition in
 * its fixture. A signal that cannot fire is indistinguishable from a signal
 * that found nothing, and this product's entire value is the difference between
 * those two.
 *
 * So: for each signal, one maximally adversarial input that it *must* flag, and
 * one clean input it *must not*. If a future threshold change quietly kills a
 * signal, the adversarial case fails here rather than reading as a clean bill of
 * health on a manipulated listing.
 *
 * These are intentionally coarse. Calibration lives in calibration.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { PRODUCT_SIGNALS, REVIEW_SIGNALS } from '../src/core/score.js';
import type { ProductSnapshot, Review } from '../src/core/types.js';

const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

function review(partial: Partial<Review> & { id: string }): Review {
  return {
    rating: 5,
    date: daysAgo(200),
    verified: true,
    // Deliberately unremarkable: detailed enough for the depth signal, specific
    // enough to dodge the phrasing heuristic, unique enough to dodge duplication.
    text: 'The mounting bracket held up fine over about 3 months of daily use, though the finish scratched more easily than I expected for the price.',
    helpfulVotes: 5,
    reviewerId: partial.id,
    ...partial,
  };
}

function snapshot(reviews: Review[], extra: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    asin: 'B000000001',
    title: 'Test product',
    displayedRating: 4.7,
    totalRatings: 5000,
    histogram: { 5: 60, 4: 15, 3: 10, 2: 8, 1: 7 },
    capturedAt: new Date().toISOString(),
    reviews,
    ...extra,
  };
}

/** Eight ordinary reviews, each textually distinct. Nothing here should flag. */
const CLEAN = snapshot(
  [
    'The mounting bracket held up fine over about 3 months of daily use, though the finish scratched more easily than I expected.',
    "Bought this to replace an older one that finally died. It's noticeably quieter, but the cable is a good 6 inches too short for my desk.",
    'Works as advertised. Took me roughly 20 minutes to assemble with the included hex key, and the instructions were mercifully clear.',
    'Decent value at around $40. Not the sturdiest thing I have owned, but it has survived two moves and a curious cat so far.',
    "Arrived a day early. The colour is a little more grey than the photos suggest, which didn't bother me but might bother someone.",
    'I use this every morning and it has held a charge for about 5 days between top-ups, which beats the 3 days the box claims.',
    'Returned my first one because the seam was split. The replacement has been perfect, so I would call it a quality-control issue.',
    'Good enough that I bought a second for the office. The rubber feet slide on glass desks, so I added felt pads underneath.',
  ].map((text, i) => review({ id: `clean-${i}`, text, rating: i % 3 === 0 ? 4 : 5 })),
);

describe('review signal liveness', () => {
  /** Maximally adversarial input per signal — the pattern each exists to catch. */
  const adversarial: Record<string, ProductSnapshot> = {
    // Eight unverified five-star ratings.
    verified: snapshot(
      Array.from({ length: 8 }, (_, i) => review({ id: `v${i}`, verified: false, rating: 5 })),
    ),

    // Disclosed incentive — the reviewer says outright that it was compensated.
    phrasing: snapshot(
      Array.from({ length: 8 }, (_, i) =>
        review({
          id: `p${i}`,
          text: 'I received this product for free in exchange for my honest and unbiased review of it.',
        }),
      ),
    ),

    // The same template body across the visible sample.
    duplication: snapshot(
      Array.from({ length: 8 }, (_, i) =>
        review({
          id: `d${i}`,
          text: 'This product arrived quickly and the build quality is absolutely outstanding for the price I paid overall here.',
        }),
      ),
    ),

    // Five of eight reviews land inside one 3-day window, against a 200-day span.
    burst: snapshot([
      ...Array.from({ length: 5 }, (_, i) => review({ id: `b${i}`, date: daysAgo(100 - i) })),
      review({ id: 'b5', date: daysAgo(200) }),
      review({ id: 'b6', date: daysAgo(150) }),
      review({ id: 'b7', date: daysAgo(10) }),
    ]),

    // Contentless five-star praise.
    depth: snapshot(Array.from({ length: 8 }, (_, i) => review({ id: `dp${i}`, rating: 5, text: 'Great!' }))),

    // Long-featured five-star reviews that nobody ever found helpful.
    helpfulness: snapshot(
      Array.from({ length: 8 }, (_, i) =>
        review({ id: `h${i}`, rating: 5, helpfulVotes: 0, date: daysAgo(365) }),
      ),
    ),
  };

  it('covers every registered review signal', () => {
    // Guards against a new signal being added without a liveness case.
    expect(REVIEW_SIGNALS.map((s) => s.id).sort()).toEqual(Object.keys(adversarial).sort());
  });

  for (const signal of REVIEW_SIGNALS) {
    describe(signal.id, () => {
      it('fires on the pattern it exists to catch', () => {
        const flagged = signal.evaluate(adversarial[signal.id]!);
        expect(flagged.size).toBeGreaterThan(0);
        // Every flag must carry a human-readable reason; the UI shows these verbatim.
        for (const { delta, reason } of flagged.values()) {
          expect(delta).toBeGreaterThan(0);
          expect(reason.trim().length).toBeGreaterThan(0);
        }
      });

      it('stays silent on ordinary reviews', () => {
        expect(signal.evaluate(CLEAN).size).toBe(0);
      });
    });
  }
});

describe('product signal liveness', () => {
  it('covers every registered product signal', () => {
    expect(PRODUCT_SIGNALS.map((s) => s.id)).toEqual(['distribution']);
  });

  for (const signal of PRODUCT_SIGNALS) {
    describe(signal.id, () => {
      it('fires on an implausible rating distribution', () => {
        // 96% five-star with no 1-star tail at all, across 5,000 ratings.
        const result = signal.evaluate(
          snapshot([review({ id: 'x' })], { histogram: { 5: 96, 4: 2, 3: 1, 2: 1, 1: 0 } }),
        );
        expect(['warn', 'fail']).toContain(result.status);
        expect(result.score).toBeLessThan(1);
        expect(result.confidence).toBeGreaterThan(0);
      });

      it('passes a J-shaped distribution that retains a negative tail', () => {
        expect(signal.evaluate(CLEAN).status).toBe('pass');
      });
    });
  }
});
