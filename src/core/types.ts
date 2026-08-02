/**
 * Core data contracts for Winnow's scoring engine.
 *
 * Everything in `src/core` is pure and dependency-free: no DOM, no chrome APIs,
 * no network. That is deliberate — this is the part we open-source and the part
 * that must be testable in isolation.
 */

export type Star = 1 | 2 | 3 | 4 | 5;

/** A single review as scraped from the page the user is already looking at. */
export interface Review {
  id: string;
  rating: Star;
  /** ISO date string. Undefined when the page didn't expose a parseable date. */
  date?: string;
  verified: boolean;
  text: string;
  title?: string;
  helpfulVotes: number;
  reviewerId?: string;
  reviewerName?: string;
}

/** Everything we could read off a product page, without making extra requests. */
export interface ProductSnapshot {
  asin: string;
  title?: string;
  /** The average rating Amazon displays. */
  displayedRating?: number;
  /** Total ratings (stars-only + written). */
  totalRatings?: number;
  /** Count of written reviews, when exposed separately from ratings. */
  totalReviews?: number;
  /**
   * Rating histogram as percentages keyed by star, e.g. { 5: 78, 4: 12, ... }.
   * Amazon renders these as whole percentages, so they may not sum to exactly 100.
   */
  histogram?: Partial<Record<Star, number>>;
  /** The reviews actually visible on the page. Typically 8-13.   */
  reviews: Review[];
  /**
   * Where the visible reviews came from, which decides how far they can be
   * trusted to represent the whole review base.
   *
   * `featured` is the handful Amazon chose to surface on a `/dp/` page. Amazon
   * decides that selection and can change it without our code changing, so it
   * is a biased sample no matter how many of them there are. `listing` is a
   * `/product-reviews/` page, where the sample is at least drawn in a stated
   * order rather than hand-picked for the product page.
   *
   * Defaults to `featured` wherever it is missing, because that is both the
   * common case and the conservative one.
   */
  sampleSource?: SampleSource;
  /**
   * Language of the storefront page, as a BCP-47 tag from `<html lang>`.
   *
   * The manifest matches fourteen Amazon domains and eleven of them are not
   * English, so "what language is this" is load-bearing rather than cosmetic:
   * it decides which phrase lists the language check may use, and whether that
   * check is allowed to run at all. Undefined means we could not tell, which is
   * treated the same as unsupported — guessing English is precisely how the
   * engine came to assert that Japanese reviews had no text in them.
   */
  language?: string;
  capturedAt: string;
}

export type SampleSource = 'featured' | 'listing';

export type SignalStatus = 'pass' | 'warn' | 'fail' | 'insufficient-data';

/**
 * A per-review judgement. `suspicion` is 0 (looks genuine) to 1 (almost
 * certainly manipulated) and becomes the review's down-weight in the adjusted
 * rating.
 */
export interface ReviewAssessment {
  reviewId: string;
  suspicion: number;
  reasons: string[];
}

/** A product-level finding that can't be attributed to individual reviews. */
export interface SignalResult {
  id: string;
  label: string;
  status: SignalStatus;
  /** 0 = maximally suspicious, 1 = clean. */
  score: number;
  /** How much this signal counts toward the final grade. */
  weight: number;
  /** 0-1. How much data actually backed this judgement. */
  confidence: number;
  /** Plain-English explanation shown directly to the user. */
  detail: string;
  evidence?: string[];
  /**
   * What the grade would have been with this check switched off.
   *
   * Absent when the analysis was refused for thin evidence, since there is no
   * grade to attribute. See `SignalContribution` for why this is a leave-one-out
   * re-run rather than a share of the weighted total.
   */
  contribution?: SignalContribution;
}

/**
 * A check's marginal effect on the grade, measured by removing it and re-scoring.
 *
 * It would be cheaper to show each check's weight as a percentage of the total,
 * and it would be wrong. The grade is not a linear function of the weighted
 * mean: `capGradeByDiscountedShare` can override the score outright, and its
 * corroboration gate makes a check's effect depend on which *other* checks
 * fired. A weight bar would confidently misdescribe all of that.
 *
 * Leave-one-out is the honest measurement, and it is the number a user actually
 * wants — not "how much does this count" but "would the answer change without
 * it". It is also what makes a rejected grade diagnosable: when someone says the
 * grade is wrong, the recorded contributions say which check to go and look at.
 */
export interface SignalContribution {
  /** Grade produced when this check is excluded from the engine. */
  gradeWithout: Grade;
  /** Trust score produced when this check is excluded. */
  trustScoreWithout: number;
  /** Signed points this check moved the trust score, positive = pushed the grade down. */
  trustScoreDelta: number;
  /** True when removing this check on its own changes the letter grade. */
  decisive: boolean;
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type ConfidenceLevel = 'high' | 'moderate' | 'low' | 'very-low';

export interface Analysis {
  asin: string;
  grade: Grade;
  /** 0-100. Higher is more trustworthy. */
  trustScore: number;
  /** The displayed rating, recomputed with suspicious reviews down-weighted. */
  adjustedRating: number | null;
  displayedRating: number | null;
  /** How many of the sampled reviews we substantially discounted. */
  discountedCount: number;
  /**
   * How many checks reached caution or flagged, independent of discountedCount.
   * A review can be flagged by a check without accumulating enough suspicion to
   * be discounted, so the panel must not report "nothing flagged" off the other
   * number alone.
   */
  concerningSignals: number;
  sampleSize: number;
  confidence: ConfidenceLevel;
  /** Honest, user-facing statement of what this analysis is based on. */
  basis: string;
  signals: SignalResult[];
  assessments: ReviewAssessment[];
  /** Set when we could not read enough of the page to say anything useful. */
  insufficientData: boolean;
  engineVersion: string;
  analysedAt: string;
}

/** A signal that examines the product as a whole. */
export interface ProductSignal {
  id: string;
  label: string;
  weight: number;
  evaluate(snapshot: ProductSnapshot): SignalResult;
}

/** A signal that examines reviews individually and returns suspicion deltas. */
export interface ReviewSignal {
  id: string;
  label: string;
  /**
   * Why this check cannot run on this snapshot, or null when it can.
   *
   * A check that has no way to detect its target must say so. Returning an
   * empty result set instead renders in the panel as a clean pass, and a clean
   * pass the engine did not earn is worse than no answer — it is the one output
   * a user cannot tell apart from a real finding of nothing. The reason string
   * is shown to the user verbatim, so it should say what was missing.
   */
  unavailable?(snapshot: ProductSnapshot): string | null;
  /**
   * Returns a map of reviewId -> { delta, reason }. Deltas are additive
   * contributions to that review's suspicion, clamped later.
   */
  evaluate(snapshot: ProductSnapshot): Map<string, { delta: number; reason: string }>;
}
