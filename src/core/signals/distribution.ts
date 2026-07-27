import type { ProductSignal, ProductSnapshot, SignalResult, Star } from '../types.js';
import { clamp } from '../text.js';

const STARS: Star[] = [1, 2, 3, 4, 5];

interface Shares {
  five: number;
  four: number;
  three: number;
  two: number;
  one: number;
  middle: number;
}

/** Normalise Amazon's whole-percentage histogram into shares summing to 1. */
export function toShares(histogram: Partial<Record<Star, number>>): Shares | null {
  const values = STARS.map((s) => histogram[s] ?? 0);
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const [one, two, three, four, five] = values.map((v) => v / total) as [
    number, number, number, number, number,
  ];
  return { one, two, three, four, five, middle: two + three + four };
}

/**
 * Real product ratings are J-shaped: a large 5-star mass, a thin 2-4 middle, and
 * a persistent 1-star tail from shipping damage, defects and mismatched
 * expectations. That 1-star tail is the hard part to fake — campaigns add 5s but
 * cannot remove organic 1s. So a very high 5-star share combined with a nearly
 * absent 1-star tail is the strongest histogram-level tell of manipulation.
 */
export const distributionSignal: ProductSignal = {
  id: 'distribution',
  label: 'Rating distribution',
  weight: 1.4,

  evaluate(snapshot: ProductSnapshot): SignalResult {
    const base = {
      id: this.id,
      label: this.label,
      weight: this.weight,
    };

    if (!snapshot.histogram) {
      return {
        ...base,
        status: 'insufficient-data',
        score: 0.5,
        confidence: 0,
        detail: "Couldn't read the rating breakdown on this page.",
      };
    }

    const shares = toShares(snapshot.histogram);
    if (!shares) {
      return {
        ...base,
        status: 'insufficient-data',
        score: 0.5,
        confidence: 0,
        detail: 'The rating breakdown on this page was empty.',
      };
    }

    // Confidence scales with how many ratings back the histogram.
    const n = snapshot.totalRatings ?? 0;
    const confidence = n === 0 ? 0.3 : clamp(Math.log10(n + 1) / 3);

    const evidence: string[] = [];
    let suspicion = 0;

    // 1. Implausibly absent negative tail.
    //    Even outstanding products retain a 1-star tail. Below ~2% at high
    //    volume is very hard to achieve honestly.
    if (shares.five > 0.8) {
      const expectedFloor = 0.02;
      if (shares.one < expectedFloor) {
        const severity = clamp((expectedFloor - shares.one) / expectedFloor);
        suspicion += 0.55 * severity * clamp((shares.five - 0.8) / 0.15);
        evidence.push(
          `${pct(shares.five)} of ratings are 5-star but only ${pct(shares.one)} are 1-star — genuine products of this size almost always retain a larger negative tail.`,
        );
      }
    }

    // 2. Hollow middle. Manipulation inflates 5s without generating the
    //    lukewarm 3-4 star reviews that accompany real satisfaction spread.
    if (shares.five > 0.75 && shares.middle < 0.08) {
      const severity = clamp((0.08 - shares.middle) / 0.08);
      suspicion += 0.35 * severity;
      evidence.push(
        `Only ${pct(shares.middle)} of ratings fall in the 2-4 star range, which is unusually hollow for a product with this much 5-star volume.`,
      );
    }

    // 3. Polarised split with an empty middle. Often a sign of review
    //    hijacking: reviews inherited from a different product sit alongside
    //    reviews for the current one.
    if (shares.five > 0.5 && shares.one > 0.2 && shares.middle < 0.15) {
      suspicion += 0.25;
      evidence.push(
        `Ratings are split between ${pct(shares.five)} 5-star and ${pct(shares.one)} 1-star with little in between. This can indicate the listing changed products at some point.`,
      );
    }

    suspicion = clamp(suspicion);
    const score = 1 - suspicion;

    let status: SignalResult['status'] = 'pass';
    if (suspicion >= 0.5) status = 'fail';
    else if (suspicion >= 0.2) status = 'warn';

    const detail =
      evidence.length > 0
        ? evidence[0]!
        : `The spread across star ratings looks consistent with organic reviews (${pct(shares.five)} 5-star, ${pct(shares.one)} 1-star).`;

    return { ...base, status, score, confidence, detail, evidence };
  },
};

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}
