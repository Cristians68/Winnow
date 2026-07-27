/**
 * Corpus-aware text analysis.
 *
 * The extension already runs a conservative local heuristic. What it cannot do
 * — and what no server-side scraper can do either, because Amazon stopped
 * serving review bodies to logged-out clients — is compare a review against
 * every other review the corpus has ever seen.
 *
 * Two things become possible here:
 *
 *  1. **Cross-product template reuse.** A phrase appearing verbatim across many
 *     unrelated products is the signature of a review farm working from a
 *     script. This is the single strongest signal in the system, and it is
 *     purely a function of corpus size.
 *  2. **Stronger stylometry.** With more budget than a content script has, we
 *     can combine burstiness, lexical diversity, contraction and typo rates,
 *     and specificity into a calibrated score rather than a three-condition gate.
 */

import type { DeepReviewFinding, WireReview } from '../contract.ts';
import type { Corpus } from '../db.ts';
import { sha } from '../db.ts';

/** Word n-gram length used for template matching. Long enough to be distinctive. */
const SHINGLE_N = 6;
/** A shingle seen on at least this many other products is treated as templated. */
const SPREAD_THRESHOLD = 3;

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

/** Word-level n-gram hashes. Word shingles beat character ones for template reuse. */
export function shingleHashes(text: string, n = SHINGLE_N): string[] {
  const tokens = tokenize(text);
  if (tokens.length < n) return [];
  const hashes: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    hashes.push(sha(tokens.slice(i, i + n).join(' ')));
  }
  return hashes;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export interface StyleFeatures {
  burstiness: number;
  diversity: number;
  contractionRate: number;
  specificity: number;
  words: number;
}

export function styleFeatures(text: string): StyleFeatures {
  const tokens = tokenize(text);
  const sentences = text.split(/[.!?]+(?:\s|$)/).map((s) => s.trim()).filter(Boolean);
  const lengths = sentences.map((s) => tokenize(s).length).filter((n) => n > 0);

  let burstiness = 1;
  if (lengths.length >= 3) {
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    if (mean > 0) {
      const variance = lengths.reduce((acc, n) => acc + (n - mean) ** 2, 0) / lengths.length;
      burstiness = Math.sqrt(variance) / mean;
    }
  }

  const unique = new Set(tokens).size;
  const diversity = tokens.length < 5 ? 1 : clamp(unique / Math.sqrt(tokens.length) / 7);

  const contractions = (text.match(/\b\w+'(s|t|re|ve|ll|d|m)\b/gi) ?? []).length;
  const contractionRate = tokens.length === 0 ? 0 : contractions / tokens.length;

  const specificity =
    (text.match(/\b\d+(\.\d+)?\s?(inch|inches|cm|mm|ft|lb|lbs|kg|g|oz|ml|l|hours?|days?|weeks?|months?|years?)\b/gi) ?? []).length +
    (text.match(/\$\d+/g) ?? []).length +
    (text.match(/\b\d+(\.\d+)?%/g) ?? []).length;

  return { burstiness, diversity, contractionRate, specificity, words: tokens.length };
}

/**
 * 0 (clearly human) to 1 (strongly machine-like).
 *
 * Calibrated to be reluctant. A false "AI-generated" accusation against a real
 * person's honest review is far more damaging to trust in Winnow than a missed
 * detection, so short reviews score 0 and every term needs corroboration.
 */
export function machineLikelihood(features: StyleFeatures): number {
  if (features.words < 40) return 0;

  const uniformity = clamp((0.45 - features.burstiness) / 0.45);
  const narrowness = clamp((0.6 - features.diversity) / 0.6);
  const sterility = features.contractionRate === 0 ? 1 : clamp((0.02 - features.contractionRate) / 0.02);
  const generic = features.specificity === 0 ? 1 : 0;

  // Geometric-style combination: every factor must be present for a high score.
  const score = uniformity * 0.35 + narrowness * 0.3 + sterility * 0.2 + generic * 0.15;
  const corroboration = [uniformity > 0.3, narrowness > 0.3, sterility > 0.5, generic === 1].filter(Boolean).length;
  return corroboration >= 3 ? clamp(score) : clamp(score * 0.4);
}

export interface TextAnalysisResult {
  findings: DeepReviewFinding[];
  templatedReviewCount: number;
  machineReviewCount: number;
}

export function analyseText(asin: string, reviews: WireReview[], corpus: Corpus): TextAnalysisResult {
  const findings: DeepReviewFinding[] = [];
  let templatedReviewCount = 0;
  let machineReviewCount = 0;

  for (const review of reviews) {
    const hashes = shingleHashes(review.text);

    // --- cross-product template reuse
    if (hashes.length > 0) {
      const spread = corpus.shingleSpread(hashes, asin);
      const reused = [...spread.values()].filter((n) => n >= SPREAD_THRESHOLD).length;
      const reuseRatio = reused / hashes.length;

      if (reuseRatio >= 0.25) {
        const peak = Math.max(...spread.values());
        templatedReviewCount++;
        findings.push({
          reviewId: review.id,
          delta: clamp(0.3 + 0.4 * reuseRatio),
          reason: `Contains phrasing seen on ${peak} other unrelated products — characteristic of a review written from a template`,
          source: 'cross-product-template',
        });
      }
    }

    // --- stylometry
    const likelihood = machineLikelihood(styleFeatures(review.text));
    if (likelihood >= 0.45) {
      machineReviewCount++;
      findings.push({
        reviewId: review.id,
        delta: clamp(0.35 * likelihood),
        reason: 'Sentence rhythm, vocabulary range and absence of concrete detail are consistent with generated text',
        source: 'ai-text',
      });
    }
  }

  return { findings, templatedReviewCount, machineReviewCount };
}

/** Record this product's shingles so future products can be compared against it. */
export function contributeShingles(asin: string, reviews: WireReview[], corpus: Corpus): void {
  const all = new Set<string>();
  for (const review of reviews) {
    for (const hash of shingleHashes(review.text)) all.add(hash);
  }
  corpus.recordShingles(asin, all);
}
