/**
 * Deep-analysis orchestrator.
 *
 * Runs the three corpus-dependent signals, folds the product's own data back
 * into the corpus, and caches the result **per ASIN**. That caching is what
 * makes the economics work: the hundredth person to view a product costs
 * nothing to serve, so compute scales with products analysed rather than with
 * users.
 */

import type { DeepAnalysisRequest, DeepAnalysisResponse, WireReview } from './contract.ts';
import { CONTRACT_VERSION } from './contract.ts';
import { Corpus, sha } from './db.ts';
import { hashIdentifier } from './privacy.ts';
import { analyseText, contributeShingles } from './signals/aitext.ts';
import { analyseNetwork, contributeReviewers } from './signals/network.ts';
import { analyseHistory } from './signals/hijack.ts';

export const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Identify a review by its content rather than by Amazon's DOM id, which is not
 * stable across page loads or locales.
 */
export function reviewKeyFor(review: WireReview): string {
  return sha(`${review.rating}|${review.date ?? ''}|${review.text.slice(0, 400).toLowerCase().replace(/\s+/g, ' ')}`);
}

export function runDeepAnalysis(request: DeepAnalysisRequest, corpus: Corpus): DeepAnalysisResponse {
  const { asin } = request;

  // A product whose listing or volume changed materially must not serve a stale
  // verdict, so record first and let the change invalidate the cache.
  const previous = corpus.observations(asin).at(-1);
  const materialChange =
    previous !== undefined &&
    ((request.titleHash !== undefined && previous.titleHash !== null && request.titleHash !== previous.titleHash) ||
      (request.totalRatings !== undefined &&
        previous.totalRatings !== null &&
        Math.abs(request.totalRatings - previous.totalRatings) > Math.max(50, previous.totalRatings * 0.1)));

  if (materialChange) corpus.invalidateCache(asin);

  const cached = corpus.readCache(asin, CACHE_TTL_MS) as DeepAnalysisResponse | null;
  if (cached) {
    recordObservation(request, corpus);
    return { ...cached, cached: true };
  }

  // Hash reviewer identifiers before anything else touches them.
  const reviewerHashes = new Map<string, string>();
  for (const review of request.reviews) {
    if (review.reviewerId) reviewerHashes.set(review.id, hashIdentifier(review.reviewerId));
  }

  const text = analyseText(asin, request.reviews, corpus);
  const network = analyseNetwork(asin, request.reviews, reviewerHashes, corpus);

  recordObservation(request, corpus);
  contributeShingles(asin, request.reviews, corpus);
  contributeReviewers(asin, request.reviews, reviewerHashes, corpus, reviewKeyFor);

  const history = analyseHistory(asin, corpus);

  const response: DeepAnalysisResponse = {
    contractVersion: CONTRACT_VERSION,
    asin,
    reviewFindings: [...text.findings, ...network.reviewFindings],
    productFindings: [
      {
        id: 'ai-text',
        label: 'Generated and templated text',
        status:
          text.templatedReviewCount + text.machineReviewCount === 0
            ? 'pass'
            : text.templatedReviewCount + text.machineReviewCount >= Math.max(2, request.reviews.length * 0.3)
              ? 'fail'
              : 'warn',
        detail:
          text.templatedReviewCount + text.machineReviewCount === 0
            ? 'No templated or machine-generated review text detected.'
            : `${text.templatedReviewCount} review(s) reuse phrasing seen on other products; ${text.machineReviewCount} read as machine-generated.`,
        evidence: text.findings.slice(0, 4).map((f) => f.reason),
      },
      network.productFinding,
      ...history,
    ],
    corpusObservations: corpus.observationCount(asin),
    cached: false,
    computedAt: new Date().toISOString(),
  };

  corpus.writeCache(asin, response);
  return response;
}

function recordObservation(request: DeepAnalysisRequest, corpus: Corpus): void {
  corpus.recordObservation(request.asin, {
    displayedRating: request.displayedRating ?? null,
    totalRatings: request.totalRatings ?? null,
    titleHash: request.titleHash ?? null,
    histogram: request.histogram ? JSON.stringify(request.histogram) : null,
  });
  corpus.pruneDuplicateObservations(request.asin);
}
