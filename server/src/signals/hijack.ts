/**
 * Review hijacking and rating-history analysis.
 *
 * The scam: a seller accumulates thousands of genuine reviews on a cheap item,
 * then edits the listing to sell something entirely different. The reviews —
 * and the 4.8 star rating — carry over to a product nobody has ever reviewed.
 *
 * This is invisible in a single page load. It is only detectable by having
 * watched the same ASIN over time, which is exactly what the corpus provides
 * and what a one-shot scraper can never reconstruct.
 */

import type { DeepProductFinding } from '../contract.ts';
import type { Corpus, ObservationRow } from '../db.ts';

/** A rating moving more than this between observations is a structural change. */
const RATING_JUMP = 0.4;

export function analyseHistory(asin: string, corpus: Corpus): DeepProductFinding[] {
  const history = corpus.observations(asin);
  const findings: DeepProductFinding[] = [];

  if (history.length < 2) {
    findings.push({
      id: 'rating-history',
      label: 'Rating history',
      status: 'insufficient-data',
      detail:
        'Winnow has only seen this product once. History-based checks need at least two observations over time.',
    });
    return findings;
  }

  findings.push(detectHijack(history));
  findings.push(detectRatingShifts(history));
  return findings;
}

function detectHijack(history: ObservationRow[]): DeepProductFinding {
  const titled = history.filter((h) => h.titleHash);
  const distinctTitles = new Set(titled.map((h) => h.titleHash));

  if (distinctTitles.size <= 1) {
    return {
      id: 'review-hijack',
      label: 'Listing changes',
      status: 'pass',
      detail: 'This listing has sold the same product every time Winnow has seen it.',
    };
  }

  // A title change is only alarming if the review count carried over, which is
  // the whole point of hijacking. A genuinely new listing starts near zero.
  const evidence: string[] = [];
  let carriedOver = false;

  for (let i = 1; i < titled.length; i++) {
    const prev = titled[i - 1]!;
    const curr = titled[i]!;
    if (prev.titleHash === curr.titleHash) continue;

    const prevCount = prev.totalRatings ?? 0;
    const currCount = curr.totalRatings ?? 0;
    const retained = prevCount > 100 && currCount >= prevCount * 0.8;

    evidence.push(
      retained
        ? `The product on this listing changed on ${curr.observedAt.slice(0, 10)} while ${currCount.toLocaleString()} existing ratings carried over.`
        : `The product on this listing changed on ${curr.observedAt.slice(0, 10)}.`,
    );
    if (retained) carriedOver = true;
  }

  return {
    id: 'review-hijack',
    label: 'Listing changes',
    status: carriedOver ? 'fail' : 'warn',
    detail: carriedOver
      ? 'This listing changed product while keeping its existing reviews. Those reviews describe something you are not buying.'
      : 'This listing has changed product at least once since Winnow first saw it.',
    evidence,
  };
}

function detectRatingShifts(history: ObservationRow[]): DeepProductFinding {
  const evidence: string[] = [];

  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]!;
    const curr = history[i]!;
    if (prev.displayedRating === null || curr.displayedRating === null) continue;

    const delta = curr.displayedRating - prev.displayedRating;
    if (Math.abs(delta) < RATING_JUMP) continue;

    const added = (curr.totalRatings ?? 0) - (prev.totalRatings ?? 0);
    const base = prev.totalRatings ?? 0;

    // Moving an established average sharply requires a flood of new ratings.
    // A big move without one means older ratings were removed or suppressed.
    const suspicious = base > 200 && added < base * 0.15;
    evidence.push(
      `Rating moved ${delta > 0 ? '+' : ''}${delta.toFixed(1)} to ${curr.displayedRating.toFixed(1)} on ${curr.observedAt.slice(0, 10)}` +
        (suspicious
          ? ` with only ${added.toLocaleString()} new ratings against a base of ${base.toLocaleString()} — too few to move the average that far honestly.`
          : ` alongside ${added.toLocaleString()} new ratings.`),
    );
  }

  if (evidence.length === 0) {
    return {
      id: 'rating-history',
      label: 'Rating history',
      status: 'pass',
      detail: `Rating has been stable across the ${history.length} times Winnow has seen this product.`,
    };
  }

  return {
    id: 'rating-history',
    label: 'Rating history',
    status: evidence.length > 1 ? 'fail' : 'warn',
    detail: 'This product’s rating has moved in ways that are hard to explain through organic reviewing.',
    evidence,
  };
}
