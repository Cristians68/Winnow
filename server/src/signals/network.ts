/**
 * Reviewer-network analysis.
 *
 * Genuine reviewers of a phone case have essentially nothing else in common.
 * Reviewers hired through the same broker work through the same product lists,
 * so their review histories overlap far beyond chance.
 *
 * Detecting that requires knowing what *else* each reviewer has reviewed, which
 * requires a corpus spanning many products — the capability a single-page
 * scraper structurally cannot have.
 *
 * All reviewer identifiers arriving here are already HMAC-hashed (see
 * privacy.ts). This module never sees an Amazon profile id in the clear.
 */

import type { DeepProductFinding, DeepReviewFinding, WireReview } from '../contract.ts';
import type { Corpus } from '../db.ts';

/** Reviewers must share at least this many other products to count as linked. */
const OVERLAP_THRESHOLD = 2;
/** Below this many identifiable reviewers there is no meaningful graph. */
const MIN_REVIEWERS = 4;

export interface NetworkResult {
  reviewFindings: DeepReviewFinding[];
  productFinding: DeepProductFinding;
}

export function analyseNetwork(
  asin: string,
  reviews: WireReview[],
  reviewerHashes: Map<string, string>,
  corpus: Corpus,
): NetworkResult {
  const identifiable = reviews.filter((r) => reviewerHashes.has(r.id));

  if (identifiable.length < MIN_REVIEWERS) {
    return {
      reviewFindings: [],
      productFinding: {
        id: 'reviewer-network',
        label: 'Reviewer network',
        status: 'insufficient-data',
        detail:
          'Not enough reviewer profiles were visible on this page to look for coordinated accounts.',
      },
    };
  }

  // Each reviewer's other products, from the corpus.
  const history = new Map<string, Set<string>>();
  for (const review of identifiable) {
    const hash = reviewerHashes.get(review.id)!;
    if (history.has(hash)) continue;
    history.set(hash, new Set(corpus.asinsForReviewer(hash).filter((a) => a !== asin)));
  }

  // Pairwise overlap between reviewers on this product.
  const linkCount = new Map<string, number>();
  const sharedPeak = new Map<string, number>();
  const hashes = [...history.keys()];

  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      const a = hashes[i]!;
      const b = hashes[j]!;
      const setA = history.get(a)!;
      const setB = history.get(b)!;
      if (setA.size === 0 || setB.size === 0) continue;

      let shared = 0;
      for (const item of setA) if (setB.has(item)) shared++;
      if (shared < OVERLAP_THRESHOLD) continue;

      for (const hash of [a, b]) {
        linkCount.set(hash, (linkCount.get(hash) ?? 0) + 1);
        sharedPeak.set(hash, Math.max(sharedPeak.get(hash) ?? 0, shared));
      }
    }
  }

  const reviewFindings: DeepReviewFinding[] = [];
  for (const review of identifiable) {
    const hash = reviewerHashes.get(review.id)!;
    const links = linkCount.get(hash);
    if (!links) continue;

    const shared = sharedPeak.get(hash) ?? OVERLAP_THRESHOLD;
    reviewFindings.push({
      reviewId: review.id,
      delta: Math.min(1, 0.2 + 0.12 * links + 0.05 * shared),
      reason: `This reviewer's history overlaps with ${links} other reviewer${links === 1 ? '' : 's'} on this product, sharing up to ${shared} unrelated products`,
      source: 'reviewer-network',
    });
  }

  const clusterShare = reviewFindings.length / identifiable.length;
  const status: DeepProductFinding['status'] =
    clusterShare >= 0.35 ? 'fail' : reviewFindings.length > 0 ? 'warn' : 'pass';

  return {
    reviewFindings,
    productFinding: {
      id: 'reviewer-network',
      label: 'Reviewer network',
      status,
      detail:
        reviewFindings.length === 0
          ? `No unusual overlap found between the ${identifiable.length} identifiable reviewers on this product.`
          : `${reviewFindings.length} of ${identifiable.length} identifiable reviewers have review histories that overlap each other well beyond chance.`,
      evidence: reviewFindings.slice(0, 4).map((f) => f.reason),
    },
  };
}

/** Store this product's reviewer sightings so future lookups can use them. */
export function contributeReviewers(
  asin: string,
  reviews: WireReview[],
  reviewerHashes: Map<string, string>,
  corpus: Corpus,
  reviewKeyFor: (review: WireReview) => string,
): void {
  for (const review of reviews) {
    corpus.upsertReview(asin, {
      reviewKey: reviewKeyFor(review),
      rating: review.rating,
      date: review.date ?? null,
      verified: review.verified ? 1 : 0,
      helpfulVotes: review.helpfulVotes,
      reviewerHash: reviewerHashes.get(review.id) ?? null,
      wordCount: (review.text.match(/\S+/g) ?? []).length,
    });
  }
}
