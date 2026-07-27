/**
 * The wire contract between the extension and the deep-analysis server.
 *
 * Two rules shape everything in this file:
 *
 *  1. The client sends facts about a **public product listing**, never facts
 *     about the person looking at it. There is no user id, no session token, no
 *     device id, and no field in which one could be smuggled — see privacy.ts,
 *     which rejects anything not named here.
 *  2. Requests are keyed by ASIN and cached by ASIN, so the marginal cost of an
 *     additional user viewing an already-analysed product is zero.
 */

export const CONTRACT_VERSION = 1;

/** A single review, as the client observed it on a public product page. */
export interface WireReview {
  /** Stable within a request only. Used to map results back to the DOM. */
  id: string;
  rating: 1 | 2 | 3 | 4 | 5;
  /** ISO date (YYYY-MM-DD). Omitted when the page didn't expose one. */
  date?: string;
  verified: boolean;
  text: string;
  helpfulVotes: number;
  /**
   * Amazon's public reviewer profile id. This identifies the *reviewer whose
   * review is published on Amazon*, never the Winnow user. It is HMAC-hashed on
   * arrival and the raw value is never stored.
   */
  reviewerId?: string;
}

export interface DeepAnalysisRequest {
  contractVersion: number;
  asin: string;
  displayedRating?: number;
  totalRatings?: number;
  /** Percentages keyed by star. */
  histogram?: Partial<Record<'1' | '2' | '3' | '4' | '5', number>>;
  /** Hash of the product title, used to detect listing swaps without storing titles. */
  titleHash?: string;
  reviews: WireReview[];
}

/** A per-review judgement the local engine could not make on its own. */
export interface DeepReviewFinding {
  reviewId: string;
  /** Additional suspicion to add to the local score, 0-1. */
  delta: number;
  reason: string;
  source: 'ai-text' | 'reviewer-network' | 'cross-product-template';
}

/** A product-level finding derived from the corpus or from history. */
export interface DeepProductFinding {
  id: 'review-hijack' | 'rating-history' | 'reviewer-network' | 'ai-text';
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'insufficient-data';
  detail: string;
  evidence?: string[];
}

export interface DeepAnalysisResponse {
  contractVersion: number;
  asin: string;
  reviewFindings: DeepReviewFinding[];
  productFindings: DeepProductFinding[];
  /** How many distinct observations of this ASIN the corpus holds. */
  corpusObservations: number;
  /** True when this response came from cache rather than fresh computation. */
  cached: boolean;
  computedAt: string;
}
