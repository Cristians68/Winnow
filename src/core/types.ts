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
  capturedAt: string;
}

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
   * Returns a map of reviewId -> { delta, reason }. Deltas are additive
   * contributions to that review's suspicion, clamped later.
   */
  evaluate(snapshot: ProductSnapshot): Map<string, { delta: number; reason: string }>;
}
