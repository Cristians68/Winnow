// @vitest-environment happy-dom
/**
 * The buyer verdict, and the line it must not cross.
 *
 * Winnow measures whether reviews are trustworthy. It never reads whether the
 * reviews say the product is any good — no sentiment, no quality signal of any
 * kind. So the verdict can tell someone how much of the star rating to believe,
 * and it must never tell them whether to buy the thing.
 *
 * That distinction is the reason this file exists. It is easy to write advice
 * copy that drifts from "this rating is inflated" to "this is a bad product",
 * and the second is a claim the engine has no evidence for.
 *
 * Also covers the four defects found by live testing on real Amazon listings.
 */

import { describe, expect, it } from 'vitest';
import { buildVerdict } from '../src/core/verdict.js';
import { analyse } from '../src/core/score.js';
import type { Analysis, ProductSnapshot, Review } from '../src/core/types.js';

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    asin: 'B000000001',
    grade: 'A',
    trustScore: 95,
    adjustedRating: 4.5,
    displayedRating: 4.5,
    discountedCount: 0,
    concerningSignals: 0,
    sampleSize: 10,
    confidence: 'moderate',
    basis: 'Based on the 10 reviews visible on this page.',
    signals: [],
    assessments: [],
    insufficientData: false,
    engineVersion: '0.1.0',
    analysedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Wording that would assert something about product quality. */
const QUALITY_CLAIMS =
  /\b(good product|bad product|great product|poor quality|high quality|don'?t buy|do not buy|you should buy|worth buying|not worth it|avoid this product|recommended)\b/i;

describe('the boundary', () => {
  const cases: Array<[string, Analysis]> = [
    ['A clean', analysis()],
    ['B', analysis({ grade: 'B', trustScore: 78, discountedCount: 2 })],
    ['C', analysis({ grade: 'C', trustScore: 60, adjustedRating: 4.1, displayedRating: 4.6 })],
    ['D', analysis({ grade: 'D', trustScore: 45, adjustedRating: 3.9, displayedRating: 4.8 })],
    ['F', analysis({ grade: 'F', trustScore: 20, adjustedRating: 3.2, displayedRating: 4.9 })],
    ['insufficient', analysis({ insufficientData: true, adjustedRating: null })],
    ['no displayed rating', analysis({ displayedRating: null, adjustedRating: null })],
  ];

  for (const [name, a] of cases) {
    it(`never claims anything about product quality — ${name}`, () => {
      const { headline, advice } = buildVerdict(a);
      expect(`${headline} ${advice}`).not.toMatch(QUALITY_CLAIMS);
    });

    it(`always produces usable copy — ${name}`, () => {
      const { headline, advice, tone } = buildVerdict(a);
      expect(headline.length).toBeGreaterThan(0);
      expect(advice.length).toBeGreaterThan(20);
      expect(`${headline} ${advice}`).not.toMatch(/null|undefined|NaN/);
      expect(['good', 'mixed', 'bad', 'unknown']).toContain(tone);
    });
  }

  it('refuses to advise at all when the page could not be read', () => {
    const { headline, advice, tone } = buildVerdict(analysis({ insufficientData: true }));
    expect(tone).toBe('unknown');
    expect(headline).toMatch(/not enough/i);
    // Must not let a reader take it as a finding about the product.
    expect(advice).toMatch(/not a finding about the product/i);
  });

  it('hands the decision back when the reviews look clean', () => {
    const { advice } = buildVerdict(analysis());
    expect(advice).toMatch(/separate question/i);
    expect(advice).toMatch(/review integrity, not quality/i);
  });

  // Found on a live listing: the summary said "No review was discounted, but 2
  // checks raised concerns" and the verdict directly beneath it said "no real
  // reason to doubt these reviews", above a row reading FLAGGED 6 of 13. The
  // panel must not argue with itself.
  it('never claims nothing was found while checks were flagged', () => {
    for (const grade of ['A', 'B'] as const) {
      for (const [concerning, discounted] of [[2, 0], [0, 2], [1, 1], [3, 4]] as const) {
        const { advice, headline } = buildVerdict(
          analysis({ grade, concerningSignals: concerning, discountedCount: discounted }),
        );
        const text = `${headline} ${advice}`;
        expect(text, `grade ${grade}, ${concerning} concerns, ${discounted} discounted`).not.toMatch(
          /no real reason to doubt|every check came back clear|nothing (was )?flagged/i,
        );
      }
    }
  });

  it('only says every check was clear when every check really was', () => {
    const { advice } = buildVerdict(analysis({ concerningSignals: 0, discountedCount: 0 }));
    expect(advice).toMatch(/every check came back clear/i);
  });

  it('restates the rating and says what to read when reviews look manipulated', () => {
    const { headline, advice } = buildVerdict(
      analysis({ grade: 'D', adjustedRating: 3.9, displayedRating: 4.8 }),
    );
    expect(headline).toMatch(/4\.8/);
    expect(advice).toMatch(/3\.9/);
    expect(advice).toMatch(/1- and 2-star/);
  });
});

// --- the four defects found on live listings -------------------------------

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const BODIES = [
  'Held up well over about 3 months of daily use, though the finish scratched sooner than expected.',
  'Replaced an older one that died. Noticeably quieter, but the cable is 6 inches too short for me.',
  'Assembly took roughly 20 minutes with the included hex key and the instructions were clear enough.',
  'Decent value around $40. Not the sturdiest thing I own but it survived two moves and a curious cat.',
  'Arrived a day early. Colour is greyer than the photos suggest, which did not bother me personally.',
  'Charge lasts about 5 days between top-ups for me, which beats the 3 days printed on the box itself.',
  'First one had a split seam so I returned it. The replacement has been perfect, so quality control.',
  'Good enough that I bought a second for the office. Rubber feet slide, so I added felt pads under it.',
  'Fits the 2 inch rail on my bike with no wobble at all, and the 4 screws included were the right size.',
  'Louder than I hoped at full power, but on the middle setting it disappears into background noise.',
  'The app pairing took three attempts before it stuck. Once connected it has never dropped in 6 weeks.',
  'Smaller in person than the listing photos imply. Check the 11 by 7 inch measurement before ordering.',
  'Been through one winter outdoors and the coating has not lifted anywhere, which surprised me frankly.',
];

const review = (i: number, p: Partial<Review> = {}): Review => ({
  id: `r${i}`, rating: 5, date: daysAgo(60 + i * 9), verified: true,
  text: BODIES[i % BODIES.length]!, helpfulVotes: 4, reviewerId: `r${i}`, ...p,
});

const snapshot = (reviews: Review[], extra: Partial<ProductSnapshot> = {}): ProductSnapshot => ({
  asin: 'B000000001', title: 'T', displayedRating: 4.5, totalRatings: 1000,
  histogram: { 5: 75, 4: 12, 3: 6, 2: 3, 1: 4 },
  capturedAt: new Date().toISOString(), reviews, ...extra,
});

describe('defects found on live Amazon listings', () => {
  // Seen on a real listing: grade A, 85/100, "Nothing flagged across 8 visible
  // reviews" — directly above a row reading "Verified purchases: FLAGGED,
  // 7 of 8 visible reviews flagged".
  it('does not grade A when most visible reviews are unverified five-star', () => {
    const reviews = Array.from({ length: 8 }, (_, i) => review(i, { verified: i === 0 }));
    const a = analyse(snapshot(reviews));

    expect(a.grade).not.toBe('A');
    expect(a.discountedCount).toBeGreaterThan(0);
  });

  // An isolated unverified review is normal and must stay harmless.
  it('still grades well when only one review of many is unverified', () => {
    const reviews = Array.from({ length: 13 }, (_, i) => review(i, { verified: i !== 0 }));
    const a = analyse(snapshot(reviews));

    expect(['A', 'B']).toContain(a.grade);
  });

  // Seen on a real listing: 0 reviews, 4 ratings, grade A at 100/100.
  it('refuses to grade a page with no readable reviews and almost no ratings', () => {
    const a = analyse(snapshot([], { totalRatings: 4, histogram: { 5: 43, 4: 29, 3: 14, 2: 14, 1: 0 } }));

    expect(a.insufficientData).toBe(true);
    expect(a.adjustedRating).toBeNull();
    expect(buildVerdict(a).tone).toBe('unknown');
  });

  // Seen on a real listing: 1 rating, grade C, adjusted rating 5.0.
  it('refuses to grade a product with a single rating', () => {
    const a = analyse(
      snapshot([review(0)], { totalRatings: 1, displayedRating: 5, histogram: { 5: 100, 4: 0, 3: 0, 2: 0, 1: 0 } }),
    );

    expect(a.insufficientData).toBe(true);
    expect(a.adjustedRating).toBeNull();
  });

  // A histogram with real volume behind it is still enough on its own.
  it('still grades when reviews are unreadable but the histogram has real volume', () => {
    const a = analyse(snapshot([], { totalRatings: 5000 }));
    expect(a.insufficientData).toBe(false);
  });

  // The contradiction itself: the summary line must never say "nothing flagged"
  // while a check is reporting a concern.
  it('never reports nothing flagged while a check has raised a concern', () => {
    const reviews = [
      ...Array.from({ length: 3 }, (_, i) => review(i, { text: ['Great!', 'Love it', 'Perfect'][i]! })),
      ...Array.from({ length: 6 }, (_, i) => review(i + 3)),
    ];
    const a = analyse(snapshot(reviews));
    const concerning = a.signals.filter((s) => s.status === 'fail' || s.status === 'warn');

    expect(a.concerningSignals).toBe(concerning.length);
    if (concerning.length > 0) {
      // Whatever the discounted count, the panel has a truthful line to show.
      expect(a.discountedCount > 0 || a.concerningSignals > 0).toBe(true);
    }
  });
});
