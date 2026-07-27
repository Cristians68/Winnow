/**
 * Calibration suite.
 *
 * The other tests prove individual signals fire on inputs built to trigger
 * them. This one asks the harder question: given realistic whole products,
 * does the grade land where a careful human would put it, and do products
 * order correctly against each other?
 *
 * It exists because live testing kept returning grade A. That was probably
 * right — the listings were legitimate — but "never seen it flag anything"
 * is an uncomfortable place to ship from. These fixtures are synthetic, so
 * they cannot replace testing a genuinely manipulated listing; what they can do
 * is pin the calibration so a future change to any signal cannot quietly turn
 * the engine credulous or paranoid without a test going red.
 *
 * If real-world testing shows these thresholds are wrong, fix them HERE first,
 * then let the failures guide the engine changes.
 */
import { describe, it, expect } from 'vitest';
import { analyse } from '../src/core/score.js';
import type { ProductSnapshot, Review, Star } from '../src/core/types.js';

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

function product(partial: Partial<ProductSnapshot>): ProductSnapshot {
  return {
    asin: 'B000000000',
    title: 'Test product',
    capturedAt: new Date().toISOString(),
    reviews: [],
    ...partial,
  };
}

let id = 0;
function rev(partial: Partial<Review>): Review {
  id++;
  return {
    id: `c${id}`,
    rating: 5,
    verified: true,
    helpfulVotes: 3,
    text: '',
    ...partial,
  };
}

// --- Fixture 1: an ordinary, honest listing --------------------------------
// Mixed ratings, specific complaints, spread-out dates, real vote counts.

const HONEST = product({
  asin: 'B00HONEST1',
  displayedRating: 4.4,
  totalRatings: 8_400,
  histogram: { 5: 64, 4: 19, 3: 7, 2: 4, 1: 6 },
  reviews: [
    ['Used it daily for about 5 weeks. Battery gives me roughly 6 hours, not the 10 advertised, but it charges fast enough that I stopped caring.', 4, 14, 40],
    ['Bought this to replace a cheaper one that died after 2 months. Noticeably heavier, and the hinge feels like it will actually last.', 5, 31, 96],
    ['Works fine, but the instructions were useless. Took me 20 minutes to figure out the mounting bracket and I still am not sure it is right.', 3, 8, 61],
    ['Third one I have owned over 4 years. Still the best option under $50 as far as I can tell, though the colour options got worse.', 5, 22, 130],
    ['Arrived with a cracked housing. Support sent a replacement within 5 days and that one has been flawless for 3 months.', 4, 11, 75],
    ['Smaller than the photos suggest. Measure before you buy — I needed 14 inches of clearance and only had 12.', 2, 40, 200],
    ['Quieter than the 2019 model I had before this. Not silent, but I can leave it running overnight now.', 5, 6, 22],
    ['The finish scratches if you look at it wrong. Performance has been consistent though, no complaints there.', 4, 3, 11],
  ].map(([text, rating, votes, ago]) =>
    rev({ text: text as string, rating: rating as Star, helpfulVotes: votes as number, date: daysAgo(ago as number) }),
  ),
});

// --- Fixture 2: a padded listing -------------------------------------------
// Real product, but someone has topped it up. A few unverified thin 5-stars
// among genuine reviews. Should be noticed, not condemned.

const PADDED = product({
  asin: 'B00PADDED1',
  displayedRating: 4.6,
  totalRatings: 3_100,
  histogram: { 5: 79, 4: 11, 3: 4, 2: 2, 1: 4 },
  reviews: [
    ...[
      ['Fit is tighter than expected. I sanded the bracket down a little and it mounted fine after that.', 4, 12, 70],
      ['App pairing failed twice before it took. Stable since, about 6 weeks now.', 4, 7, 45],
      ['Solid for the price. Picks up fingerprints constantly, which is my only real complaint.', 5, 19, 110],
      ['Returned my first one, the seal leaked. Second unit has been fine for 2 months.', 4, 5, 88],
      ['Good value. Not as bright as the 800 lumen claim suggests, more like 500 in practice.', 4, 9, 33],
    ].map(([text, rating, votes, ago]) =>
      rev({ text: text as string, rating: rating as Star, helpfulVotes: votes as number, date: daysAgo(ago as number) }),
    ),
    rev({ rating: 5, verified: false, helpfulVotes: 0, text: 'Great product!', date: daysAgo(20) }),
    rev({ rating: 5, verified: false, helpfulVotes: 0, text: 'Love it', date: daysAgo(19) }),
    rev({ rating: 5, verified: false, helpfulVotes: 0, text: 'Exactly as described, great value for the money.', date: daysAgo(19) }),
  ],
});

// --- Fixture 3: a review farm ----------------------------------------------
// Every tell at once: implausible histogram, unverified 5-stars, template
// reuse, a same-week burst, disclosed incentives, no community response.

const FARM_TEMPLATE =
  'This product exceeded my expectations and I highly recommend this product to everyone looking for quality.';

const FARM = product({
  asin: 'B00FARM001',
  displayedRating: 4.9,
  totalRatings: 4_800,
  histogram: { 5: 96, 4: 3, 3: 1, 2: 0, 1: 0 },
  reviews: [
    rev({ rating: 5, verified: false, helpfulVotes: 0, date: daysAgo(120), text: FARM_TEMPLATE }),
    rev({ rating: 5, verified: false, helpfulVotes: 0, date: daysAgo(119), text: FARM_TEMPLATE.replace('everyone', 'anyone') }),
    rev({ rating: 5, verified: false, helpfulVotes: 0, date: daysAgo(119), text: FARM_TEMPLATE.replace('quality', 'value') }),
    rev({ rating: 5, verified: false, helpfulVotes: 0, date: daysAgo(118), text: 'I received this product for free in exchange for my honest review. It works well.' }),
    rev({ rating: 5, verified: false, helpfulVotes: 0, date: daysAgo(118), text: 'Amazing' }),
    rev({ rating: 5, verified: false, helpfulVotes: 0, date: daysAgo(118), text: 'Five stars, would buy again, great product great price.' }),
    rev({ rating: 5, verified: true, helpfulVotes: 0, date: daysAgo(300), text: 'Works as expected, good quality product, highly recommend this product.' }),
    rev({ rating: 5, verified: false, helpfulVotes: 0, date: daysAgo(117), text: 'Best purchase ever' }),
  ],
});

// --- Fixture 4: unreadable page --------------------------------------------

const UNREADABLE = product({ asin: 'B00BROKEN1', reviews: [] });

// --- Fixture 5: markup broke, text missing ---------------------------------

const TEXT_BROKEN = product({
  asin: 'B00NOTEXT1',
  displayedRating: 4.5,
  totalRatings: 2_000,
  histogram: { 5: 70, 4: 15, 3: 6, 2: 3, 1: 6 },
  reviews: Array.from({ length: 12 }, (_, i) =>
    rev({ rating: 5, text: '', verified: true, date: daysAgo(i * 9 + 5) }),
  ),
});

describe('calibration: whole products land where a human would put them', () => {
  const honest = analyse(HONEST);
  const padded = analyse(PADDED);
  const farm = analyse(FARM);

  it('grades an honest listing well', () => {
    expect(['A', 'B']).toContain(honest.grade);
    expect(honest.trustScore).toBeGreaterThanOrEqual(75);
    expect(honest.adjustedRating).toBeCloseTo(4.4, 1);
  });

  it('notices a padded listing without condemning it', () => {
    expect(['B', 'C']).toContain(padded.grade);
    expect(padded.discountedCount).toBeGreaterThan(0);
    // The point of the product: the number a shopper actually acts on moves.
    expect(padded.adjustedRating!).toBeLessThan(padded.displayedRating!);
  });

  it('condemns a review farm', () => {
    expect(['D', 'F']).toContain(farm.grade);
    expect(farm.trustScore).toBeLessThan(50);
    expect(farm.discountedCount).toBeGreaterThanOrEqual(5);
  });

  // The single most important property: relative ordering. Absolute thresholds
  // may need tuning against real listings, but a farm must never outrank an
  // honest product no matter how the weights are adjusted.
  it('orders the three products correctly', () => {
    expect(honest.trustScore).toBeGreaterThan(padded.trustScore);
    expect(padded.trustScore).toBeGreaterThan(farm.trustScore);
  });

  it('separates honest from farm by a wide margin, not a rounding error', () => {
    expect(honest.trustScore - farm.trustScore).toBeGreaterThan(35);
  });

  it('flags the farm on multiple independent signals, not just one', () => {
    const failing = farm.signals.filter((s) => s.status === 'fail' || s.status === 'warn');
    expect(failing.length).toBeGreaterThanOrEqual(3);
  });

  it('explains itself on every graded product', () => {
    for (const result of [honest, padded, farm]) {
      expect(result.basis).toMatch(/estimate, not proof/);
      expect(result.signals.length).toBeGreaterThan(4);
      for (const signal of result.signals) expect(signal.detail.length).toBeGreaterThan(10);
    }
  });
});

describe('calibration: failure states stay honest', () => {
  it('declines to grade an unreadable page', () => {
    const result = analyse(UNREADABLE);
    expect(result.insufficientData).toBe(true);
    expect(result.adjustedRating).toBeNull();
    expect(result.basis).toMatch(/isn't a verdict/);
  });

  it('does not punish a product for our own parser failing', () => {
    const result = analyse(TEXT_BROKEN);
    // 12 five-star reviews with no text must not read as 12 suspicious reviews.
    expect(result.discountedCount).toBe(0);
    expect(['A', 'B', 'C']).toContain(result.grade);
    expect(result.basis).toMatch(/couldn't read the review text/i);
  });
});

describe('calibration: the adjusted rating is decision-useful', () => {
  it('leaves an honest rating essentially alone', () => {
    const result = analyse(HONEST);
    expect(Math.abs(result.adjustedRating! - result.displayedRating!)).toBeLessThan(0.25);
  });

  it('never invents precision it does not have', () => {
    const result = analyse(FARM);
    // Either a materially lower number, or an honest refusal — never 4.9.
    if (result.adjustedRating !== null) {
      expect(result.adjustedRating).toBeLessThan(4.5);
    }
  });
});
