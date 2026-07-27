import { describe, it, expect } from 'vitest';
import type { ProductSnapshot, Review, Star } from '../src/core/types.js';
import {
  analyse,
  assessReviews,
  estimateAdjustedRating,
  sampleConfidenceFrom,
  toGrade,
} from '../src/core/score.js';
import { distributionSignal, toShares } from '../src/core/signals/distribution.js';
import { duplicationSignal } from '../src/core/signals/duplication.js';
import { phrasingSignal } from '../src/core/signals/phrasing.js';
import { depthSignal } from '../src/core/signals/depth.js';
import { burstSignal } from '../src/core/signals/burst.js';
import { jaccard, trigrams, sentenceLengthVariation, matchPhrases, INCENTIVE_PHRASES } from '../src/core/text.js';

// --- helpers ---------------------------------------------------------------

let idCounter = 0;
function review(partial: Partial<Review> = {}): Review {
  idCounter++;
  return {
    id: partial.id ?? `r${idCounter}`,
    rating: partial.rating ?? 5,
    date: partial.date,
    verified: partial.verified ?? true,
    text: partial.text ?? 'This is a perfectly ordinary review with a reasonable amount of detail in it.',
    helpfulVotes: partial.helpfulVotes ?? 3,
    ...partial,
  };
}

function snapshot(partial: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    asin: 'B000TEST01',
    reviews: [],
    capturedAt: new Date().toISOString(),
    ...partial,
  };
}

/** A believable organic histogram: J-shaped with a real 1-star tail. */
const NATURAL_HISTOGRAM: Partial<Record<Star, number>> = { 5: 62, 4: 18, 3: 8, 2: 4, 1: 8 };
/** The classic manipulation signature: near-perfect 5s, no negative tail. */
const IMPLAUSIBLE_HISTOGRAM: Partial<Record<Star, number>> = { 5: 96, 4: 3, 3: 1, 2: 0, 1: 0 };

// --- text utilities --------------------------------------------------------

describe('text utilities', () => {
  it('scores identical text as fully similar and unrelated text as dissimilar', () => {
    const a = trigrams('the battery lasted about three hours in normal use');
    const b = trigrams('the battery lasted about three hours in normal use');
    const c = trigrams('completely unrelated commentary regarding packaging quality');
    expect(jaccard(a, b)).toBe(1);
    expect(jaccard(a, c)).toBeLessThan(0.3);
  });

  it('rates metronomic sentence rhythm as less variable than natural writing', () => {
    const uniform = 'This product is good. This product is nice. This product is fine. This product is great.';
    const natural =
      'Honestly? I was skeptical. But after using it every single day for about three weeks straight, including a trip where it got thoroughly abused in my luggage, I have to admit it held up. Great.';
    expect(sentenceLengthVariation(uniform)).toBeLessThan(sentenceLengthVariation(natural));
  });

  it('detects disclosed incentives', () => {
    expect(
      matchPhrases('I received this product for free in exchange for my honest review.', INCENTIVE_PHRASES).length,
    ).toBeGreaterThan(0);
    expect(matchPhrases('I bought this with my own money.', INCENTIVE_PHRASES)).toHaveLength(0);
  });
});

// --- distribution signal ---------------------------------------------------

describe('distribution signal', () => {
  it('normalises a histogram into shares', () => {
    const shares = toShares(NATURAL_HISTOGRAM)!;
    expect(shares.five).toBeCloseTo(0.62, 2);
    expect(shares.middle).toBeCloseTo(0.3, 2);
  });

  it('passes a natural J-shaped distribution', () => {
    const result = distributionSignal.evaluate(
      snapshot({ histogram: NATURAL_HISTOGRAM, totalRatings: 5000 }),
    );
    expect(result.status).toBe('pass');
    expect(result.score).toBeGreaterThan(0.9);
  });

  it('flags a near-perfect distribution with no negative tail', () => {
    const result = distributionSignal.evaluate(
      snapshot({ histogram: IMPLAUSIBLE_HISTOGRAM, totalRatings: 5000 }),
    );
    expect(result.status).toBe('fail');
    expect(result.score).toBeLessThan(0.5);
    expect(result.evidence?.[0]).toMatch(/1-star/);
  });

  it('reports insufficient data rather than guessing when the histogram is missing', () => {
    const result = distributionSignal.evaluate(snapshot({ totalRatings: 5000 }));
    expect(result.status).toBe('insufficient-data');
    expect(result.confidence).toBe(0);
  });

  it('scales confidence with the number of ratings behind the histogram', () => {
    const few = distributionSignal.evaluate(snapshot({ histogram: NATURAL_HISTOGRAM, totalRatings: 5 }));
    const many = distributionSignal.evaluate(snapshot({ histogram: NATURAL_HISTOGRAM, totalRatings: 50000 }));
    expect(many.confidence).toBeGreaterThan(few.confidence);
  });
});

// --- review signals --------------------------------------------------------

describe('phrasing signal', () => {
  it('strongly penalises a disclosed incentive', () => {
    const r = review({ text: 'I received this product for free in exchange for my honest review. It works well enough.' });
    const flagged = phrasingSignal.evaluate(snapshot({ reviews: [r] }));
    expect(flagged.get(r.id)!.delta).toBeGreaterThanOrEqual(0.45);
  });

  it('leaves a specific, naturally written review alone', () => {
    const r = review({
      text: 'Used it daily for 3 weeks. Battery gave me about 6 hours before needing a charge, which is short of the 10 hours advertised. Build quality is solid though, and the case fits.',
    });
    expect(phrasingSignal.evaluate(snapshot({ reviews: [r] })).has(r.id)).toBe(false);
  });
});

describe('duplication signal', () => {
  it('flags both members of a near-duplicate pair', () => {
    const text = 'This is an absolutely fantastic item that arrived quickly and works exactly the way I hoped it would.';
    const a = review({ id: 'dup-a', text });
    const b = review({ id: 'dup-b', text: text.replace('fantastic', 'wonderful') });
    const flagged = duplicationSignal.evaluate(snapshot({ reviews: [a, b] }));
    expect(flagged.has('dup-a')).toBe(true);
    expect(flagged.has('dup-b')).toBe(true);
  });

  it('does not flag short reviews that trivially collide', () => {
    const a = review({ id: 's-a', text: 'Great product!' });
    const b = review({ id: 's-b', text: 'Great product!' });
    expect(duplicationSignal.evaluate(snapshot({ reviews: [a, b] })).size).toBe(0);
  });
});

describe('depth signal', () => {
  it('flags a thin 5-star review', () => {
    const r = review({ rating: 5, text: 'Love it' });
    expect(depthSignal.evaluate(snapshot({ reviews: [r] })).has(r.id)).toBe(true);
  });

  it('spares a short review that contains concrete detail', () => {
    const r = review({ rating: 1, text: 'Died after 3 weeks' });
    expect(depthSignal.evaluate(snapshot({ reviews: [r] })).has(r.id)).toBe(false);
  });

  it('ignores brief middle ratings', () => {
    const r = review({ rating: 3, text: "It's fine" });
    expect(depthSignal.evaluate(snapshot({ reviews: [r] })).has(r.id)).toBe(false);
  });
});

describe('burst signal', () => {
  it('flags a tight cluster inside a long-running sample', () => {
    const reviews = [
      review({ id: 'old-1', date: '2026-01-05' }),
      review({ id: 'old-2', date: '2026-02-11' }),
      review({ id: 'b-1', date: '2026-06-01' }),
      review({ id: 'b-2', date: '2026-06-01' }),
      review({ id: 'b-3', date: '2026-06-02' }),
      review({ id: 'b-4', date: '2026-06-03' }),
    ];
    const flagged = burstSignal.evaluate(snapshot({ reviews }));
    expect(flagged.has('b-1')).toBe(true);
    expect(flagged.has('old-1')).toBe(false);
  });

  it('stays silent when reviews are evenly spread', () => {
    const reviews = ['2026-01-10', '2026-02-14', '2026-03-19', '2026-04-22', '2026-05-27', '2026-06-30'].map(
      (date, i) => review({ id: `even-${i}`, date }),
    );
    expect(burstSignal.evaluate(snapshot({ reviews })).size).toBe(0);
  });

  it('stays silent on a short sample with no baseline', () => {
    const reviews = ['2026-06-01', '2026-06-01', '2026-06-02'].map((date, i) =>
      review({ id: `tight-${i}`, date }),
    );
    expect(burstSignal.evaluate(snapshot({ reviews })).size).toBe(0);
  });
});

// --- aggregation -----------------------------------------------------------

describe('adjusted rating estimation', () => {
  it('leaves a clean product unchanged', () => {
    expect(estimateAdjustedRating(4.6, 0, 1)).toBe(4.6);
  });

  it('back-solves the genuine rating when reviews look manipulated', () => {
    // (4.6 - 5*0.3) / (1 - 0.3) = 4.43
    expect(estimateAdjustedRating(4.6, 0.3, 1)).toBeCloseTo(4.4, 1);
  });

  it('shrinks the adjustment toward the displayed rating on a small sample', () => {
    const full = estimateAdjustedRating(4.6, 0.3, 1)!;
    const partial = estimateAdjustedRating(4.6, 0.3, 0.4)!;
    expect(partial).toBeGreaterThan(full);
    expect(partial).toBeLessThan(4.6);
  });

  it('refuses to produce a number when the estimator is unstable', () => {
    expect(estimateAdjustedRating(4.6, 0.95, 1)).toBeNull();
  });

  it('returns null without a displayed rating', () => {
    expect(estimateAdjustedRating(null, 0.3, 1)).toBeNull();
  });
});

describe('sample confidence', () => {
  it('is zero with no reviews and saturates at scale', () => {
    expect(sampleConfidenceFrom(0)).toBe(0);
    expect(sampleConfidenceFrom(25)).toBeCloseTo(1, 5);
    expect(sampleConfidenceFrom(10)).toBeGreaterThan(sampleConfidenceFrom(5));
  });
});

describe('grade thresholds', () => {
  it('maps scores to letters', () => {
    expect(toGrade(95)).toBe('A');
    expect(toGrade(72)).toBe('B');
    expect(toGrade(60)).toBe('C');
    expect(toGrade(45)).toBe('D');
    expect(toGrade(10)).toBe('F');
  });
});

describe('analyse', () => {
  it('gives a clean product a high grade and no rating adjustment', () => {
    const reviews = [
      'Battery lasted about 6 hours in real use, a bit under the 10 hours claimed, but the build is solid.',
      'Bought this to replace a cheaper one that broke after 2 months. Noticeably heavier, feels sturdier.',
      'Works fine. The instructions were confusing and took me 20 minutes to figure out the mounting bracket.',
      'Third one I have owned over 4 years. Still the best option under $50 as far as I can tell.',
      'Does what it says. Slightly smaller than I pictured from the photos, measure before you buy.',
      'Arrived damaged, support sent a replacement within 5 days. The replacement has been flawless since.',
      'The finish scratches easily if you are rough with it, but performance has been consistent.',
      'Genuinely surprised by how quiet it runs compared to the 2019 model I had before this one.',
    ].map((text, i) =>
      review({ id: `clean-${i}`, rating: (i % 5 === 0 ? 4 : 5) as Star, date: `2026-0${(i % 6) + 1}-1${i % 9}`, verified: true, text }),
    );

    const result = analyse(
      snapshot({ reviews, histogram: NATURAL_HISTOGRAM, totalRatings: 8000, displayedRating: 4.3 }),
    );

    expect(result.insufficientData).toBe(false);
    expect(['A', 'B']).toContain(result.grade);
    expect(result.trustScore).toBeGreaterThan(70);
    expect(result.discountedCount).toBe(0);
    expect(result.adjustedRating).toBeCloseTo(4.3, 1);
  });

  it('grades down a product whose reviews show multiple manipulation patterns', () => {
    const template = 'This product exceeded my expectations and I highly recommend this product to everyone I know.';
    const reviews = [
      review({ id: 'bad-1', rating: 5, verified: false, text: template, date: '2026-06-01', helpfulVotes: 0 }),
      review({ id: 'bad-2', rating: 5, verified: false, text: template.replace('everyone', 'anyone'), date: '2026-06-01', helpfulVotes: 0 }),
      review({ id: 'bad-3', rating: 5, verified: false, text: 'I received this product for free in exchange for my honest review.', date: '2026-06-02', helpfulVotes: 0 }),
      review({ id: 'bad-4', rating: 5, verified: false, text: 'Love it', date: '2026-06-02', helpfulVotes: 0 }),
      review({ id: 'bad-5', rating: 5, verified: false, text: 'Great value for the money and works as expected, would buy again.', date: '2026-06-03', helpfulVotes: 0 }),
      review({ id: 'bad-6', rating: 5, verified: true, text: 'Exactly as described, great quality product, five stars.', date: '2026-01-04', helpfulVotes: 0 }),
    ];

    const result = analyse(
      snapshot({ reviews, histogram: IMPLAUSIBLE_HISTOGRAM, totalRatings: 4000, displayedRating: 4.9 }),
    );

    expect(['D', 'F']).toContain(result.grade);
    expect(result.trustScore).toBeLessThan(55);
    expect(result.discountedCount).toBeGreaterThan(2);
    // When almost nothing in the sample looks trustworthy, there is no honest
    // basis for stating a corrected rating — so we decline to invent one and
    // let the grade carry the verdict instead.
    expect(result.adjustedRating).toBeNull();
  });

  it('lowers the rating on a partially manipulated product rather than refusing', () => {
    const genuine = [
      'Used it daily for about 5 weeks now. Battery holds up better than the 2023 version I replaced.',
      'Fit is tighter than expected, I had to sand down the bracket a little to mount it properly.',
      'Works, but the app pairing failed twice before it took. Once connected it has been stable.',
      'Solid for the price. The finish picks up fingerprints constantly which is my only complaint.',
    ].map((text, i) =>
      review({ id: `g-${i}`, rating: 4 as Star, verified: true, date: `2026-0${i + 1}-12`, text }),
    );

    const planted = [
      review({ id: 'p-1', rating: 5, verified: false, helpfulVotes: 0, date: '2026-05-02', text: 'Love it' }),
      review({
        id: 'p-2',
        rating: 5,
        verified: false,
        helpfulVotes: 0,
        date: '2026-05-02',
        text: 'I received this product for free in exchange for my honest review.',
      }),
    ];

    const result = analyse(
      snapshot({
        reviews: [...genuine, ...planted],
        histogram: NATURAL_HISTOGRAM,
        totalRatings: 3000,
        displayedRating: 4.5,
      }),
    );

    expect(result.adjustedRating).not.toBeNull();
    expect(result.adjustedRating!).toBeLessThan(4.5);
    expect(result.discountedCount).toBeGreaterThan(0);
  });

  it('reports insufficient data instead of inventing a verdict on an unreadable page', () => {
    const result = analyse(snapshot({ reviews: [] }));
    expect(result.insufficientData).toBe(true);
    expect(result.confidence).toBe('very-low');
    expect(result.adjustedRating).toBeNull();
    expect(result.basis).toMatch(/isn't a verdict/);
  });

  it('always states that the result is an estimate', () => {
    const result = analyse(
      snapshot({ reviews: [review()], histogram: NATURAL_HISTOGRAM, totalRatings: 900, displayedRating: 4.4 }),
    );
    expect(result.basis).toMatch(/estimate, not proof/);
  });

  it('never assigns suspicion above 1 no matter how many signals fire', () => {
    const r = review({
      id: 'worst',
      rating: 5,
      verified: false,
      helpfulVotes: 0,
      date: '2026-06-01',
      text: 'I received this product for free in exchange for my honest review. Five stars.',
    });
    const [assessment] = assessReviews(snapshot({ reviews: [r], totalRatings: 5000 }));
    expect(assessment!.suspicion).toBeLessThanOrEqual(1);
    expect(assessment!.suspicion).toBeGreaterThan(0.5);
  });
});
