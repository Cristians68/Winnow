/**
 * Deep-analysis client contract, mirroring server/src/contract.ts.
 *
 * Deep analysis is the one part of Winnow that talks to a network, and it only
 * ever runs when the user explicitly asks for it. What gets sent is data about
 * a public product listing — never who is looking at it. See PRIVACY.md.
 */

import type { DeepAugmentation } from '../core/score.js';
import type { ProductSnapshot, SignalResult } from '../core/types.js';

export const CONTRACT_VERSION = 1;

/**
 * The hosted deep-analysis endpoint, or null when there isn't one.
 *
 * It is deliberately null in the shipped build. Deep analysis is the paid tier
 * and no service is running yet, so there is nothing honest to point at — and
 * pointing at a domain this project does not own would mean shipping a standing
 * host permission that could later resolve to somebody else's server.
 *
 * While this is null the extension reaches no network at all: the manifest
 * carries no host permission beyond Amazon itself, and the panel hides the deep
 * button rather than offering an action that can only fail. Deep analysis is
 * still fully usable against a local server via the loopback developer endpoint
 * in Options.
 *
 * To enable it: set this to the real URL and add the matching host permission to
 * src/manifest.json and ALLOWED_HOSTS in package.mjs. The packaging guard fails
 * the build if those disagree.
 */
export const API_ENDPOINT: string | null = null;

export interface DeepReviewFinding {
  reviewId: string;
  delta: number;
  reason: string;
  source: 'ai-text' | 'reviewer-network' | 'cross-product-template';
}

export interface DeepProductFinding {
  id: string;
  label: string;
  status: SignalResult['status'];
  detail: string;
  evidence?: string[];
}

export interface DeepAnalysisResponse {
  contractVersion: number;
  asin: string;
  reviewFindings: DeepReviewFinding[];
  productFindings: DeepProductFinding[];
  corpusObservations: number;
  cached: boolean;
  computedAt: string;
}

/** Non-cryptographic digest, used so the server can spot listing swaps without receiving titles. */
export async function hashTitle(title: string): Promise<string> {
  const bytes = new TextEncoder().encode(title.trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * Build the request body.
 *
 * Deliberately constructed field by field rather than by spreading the
 * snapshot: the server rejects unknown fields outright, so an accidental
 * addition here fails loudly in tests instead of silently transmitting
 * something it shouldn't.
 */
export async function buildRequest(snapshot: ProductSnapshot): Promise<Record<string, unknown>> {
  return {
    contractVersion: CONTRACT_VERSION,
    asin: snapshot.asin,
    displayedRating: snapshot.displayedRating,
    totalRatings: snapshot.totalRatings,
    histogram: snapshot.histogram
      ? Object.fromEntries(Object.entries(snapshot.histogram).map(([k, v]) => [String(k), v]))
      : undefined,
    titleHash: snapshot.title ? await hashTitle(snapshot.title) : undefined,
    reviews: snapshot.reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      date: review.date,
      verified: review.verified,
      text: review.text,
      helpfulVotes: review.helpfulVotes,
      reviewerId: review.reviewerId,
    })),
  };
}

/** Convert a server response into the augmentation the local engine consumes. */
export function toAugmentation(response: DeepAnalysisResponse): DeepAugmentation {
  return {
    reviewDeltas: response.reviewFindings.map((f) => ({
      reviewId: f.reviewId,
      delta: f.delta,
      reason: f.reason,
    })),
    signals: response.productFindings.map((f) => ({
      id: `deep:${f.id}`,
      label: f.label,
      status: f.status,
      score: f.status === 'fail' ? 0.15 : f.status === 'warn' ? 0.55 : 1,
      weight: 1.2,
      confidence: f.status === 'insufficient-data' ? 0 : 1,
      detail: f.detail,
      evidence: f.evidence,
    })),
  };
}
