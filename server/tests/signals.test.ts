import { describe, it, expect, beforeEach } from 'vitest';
import { Corpus } from '../src/db.ts';
import { hashIdentifier } from '../src/privacy.ts';
import { analyseText, contributeShingles, machineLikelihood, styleFeatures, shingleHashes } from '../src/signals/aitext.ts';
import { analyseNetwork, contributeReviewers } from '../src/signals/network.ts';
import { analyseHistory } from '../src/signals/hijack.ts';
import { runDeepAnalysis, reviewKeyFor } from '../src/deep.ts';
import type { WireReview } from '../src/contract.ts';

let corpus: Corpus;
beforeEach(() => {
  corpus = new Corpus(':memory:');
});

function review(partial: Partial<WireReview> & { id: string }): WireReview {
  return {
    rating: 5,
    verified: true,
    text: 'A perfectly ordinary review with a reasonable amount of detail in it.',
    helpfulVotes: 2,
    ...partial,
  };
}

// --- cross-product template reuse -----------------------------------------

describe('cross-product template detection', () => {
  const TEMPLATE =
    'this product arrived quickly and the build quality is absolutely outstanding for the price i paid overall';

  /** Seed a product across two days, so the phrase clears corroboration. */
  const seedCorroborated = (asin: string, text: string) => {
    corpus.recordShingles(asin, shingleHashes(text), '2026-07-01');
    corpus.recordShingles(asin, shingleHashes(text), '2026-07-02');
  };

  it('flags phrasing that has appeared on several other products', () => {
    // Seed the corpus: the same template used across four unrelated products.
    for (const asin of ['B00000001', 'B00000002', 'B00000003', 'B00000004']) {
      seedCorroborated(asin, TEMPLATE);
    }

    const result = analyseText('B00000009', [review({ id: 'target', text: TEMPLATE })], corpus);
    expect(result.templatedReviewCount).toBe(1);
    expect(result.findings[0]!.source).toBe('cross-product-template');
    expect(result.findings[0]!.reason).toMatch(/other unrelated products/);
  });

  // Anti-poisoning: a burst of submissions on one day must not be enough to
  // brand another product's text as templated.
  it('ignores phrases seen only within a single day, however many products', () => {
    for (const asin of ['B00000101', 'B00000102', 'B00000103', 'B00000104', 'B00000105']) {
      corpus.recordShingles(asin, shingleHashes(TEMPLATE), '2026-07-01');
    }
    const result = analyseText('B00000199', [review({ id: 'target', text: TEMPLATE })], corpus);
    expect(result.templatedReviewCount).toBe(0);
  });

  it('counts a phrase once corroborated across separate days', () => {
    for (const asin of ['B00000201', 'B00000202', 'B00000203', 'B00000204']) {
      corpus.recordShingles(asin, shingleHashes(TEMPLATE), '2026-07-01');
      corpus.recordShingles(asin, shingleHashes(TEMPLATE), '2026-07-05');
    }
    const result = analyseText('B00000299', [review({ id: 'target', text: TEMPLATE })], corpus);
    expect(result.templatedReviewCount).toBe(1);
  });

  it('does not let repeat submissions on the same day manufacture corroboration', () => {
    for (let i = 0; i < 10; i++) {
      corpus.recordShingles('B00000301', shingleHashes(TEMPLATE), '2026-07-01');
    }
    const spread = corpus.shingleSpread(shingleHashes(TEMPLATE), 'B00000399');
    expect([...spread.values()].every((n) => n === 0)).toBe(true);
  });

  it('leaves genuinely original text alone', () => {
    for (const asin of ['B00000001', 'B00000002', 'B00000003', 'B00000004']) {
      seedCorroborated(asin, TEMPLATE);
    }
    const original = review({
      id: 'target',
      text: 'The mounting bracket snapped after about 5 weeks of daily use on my garage door, which was disappointing given the price.',
    });
    expect(analyseText('B00000009', [original], corpus).templatedReviewCount).toBe(0);
  });

  it('says nothing on an empty corpus, since there is nothing to compare against', () => {
    expect(analyseText('B00000009', [review({ id: 'a', text: TEMPLATE })], corpus).templatedReviewCount).toBe(0);
  });

  it('ignores text too short to produce shingles', () => {
    expect(shingleHashes('great product')).toEqual([]);
  });
});

// --- stylometry ------------------------------------------------------------

describe('machine-likelihood scoring', () => {
  it('scores short reviews at zero rather than guessing', () => {
    expect(machineLikelihood(styleFeatures('Works great, love it.'))).toBe(0);
  });

  it('rates uniform, sterile, detail-free prose above natural writing', () => {
    const machine =
      'This product is an excellent choice for consumers. The design is thoughtful and modern. The materials feel premium and durable. The performance is consistent and reliable. The value proposition is strong and compelling. The overall experience is positive and satisfying. It is a worthwhile addition to any home.';
    const human =
      "Honestly wasn't expecting much for $30. It's been about 3 weeks now and the thing still works, though the button sticks sometimes — annoying but liveable. My wife hates the colour. Would I buy again? Probably, yeah.";
    expect(machineLikelihood(styleFeatures(machine))).toBeGreaterThan(machineLikelihood(styleFeatures(human)));
  });

  it('never flags writing that contains contractions and concrete detail', () => {
    const human =
      "I've had this for 6 months. Battery gives me about 4 hours, not the 8 they claim. Don't buy it if you need all-day use, but it's fine for short trips and the case is genuinely rugged. Dropped it twice on concrete, no damage at all so far.";
    expect(machineLikelihood(styleFeatures(human))).toBeLessThan(0.45);
  });
});

// --- reviewer network ------------------------------------------------------

describe('reviewer-network analysis', () => {
  function seedReviewerHistory(reviewerIds: string[], sharedAsins: string[]) {
    for (const id of reviewerIds) {
      const hash = hashIdentifier(id);
      for (const asin of sharedAsins) {
        corpus.upsertReview(asin, {
          reviewKey: `${hash}-${asin}`,
          rating: 5,
          date: '2026-01-01',
          verified: 1,
          helpfulVotes: 0,
          reviewerHash: hash,
          wordCount: 20,
        });
      }
    }
  }

  it('flags reviewers whose histories overlap far beyond chance', () => {
    const ids = ['acct-a', 'acct-b', 'acct-c', 'acct-d'];
    seedReviewerHistory(ids, ['B00000011', 'B00000012', 'B00000013']);

    const reviews = ids.map((id, i) => review({ id: `r${i}`, reviewerId: id }));
    const hashes = new Map(reviews.map((r, i) => [r.id, hashIdentifier(ids[i]!)]));

    const result = analyseNetwork('B00000099', reviews, hashes, corpus);
    expect(result.productFinding.status).toBe('fail');
    expect(result.reviewFindings.length).toBeGreaterThanOrEqual(3);
    expect(result.reviewFindings[0]!.source).toBe('reviewer-network');
  });

  it('passes reviewers with no shared history', () => {
    const ids = ['solo-a', 'solo-b', 'solo-c', 'solo-d'];
    ids.forEach((id, i) => seedReviewerHistory([id], [`B0000002${i}`]));

    const reviews = ids.map((id, i) => review({ id: `r${i}`, reviewerId: id }));
    const hashes = new Map(reviews.map((r, i) => [r.id, hashIdentifier(ids[i]!)]));

    const result = analyseNetwork('B00000099', reviews, hashes, corpus);
    expect(result.productFinding.status).toBe('pass');
    expect(result.reviewFindings).toHaveLength(0);
  });

  it('reports insufficient data when too few profiles are visible', () => {
    const reviews = [review({ id: 'r1', reviewerId: 'only-one' })];
    const hashes = new Map([['r1', hashIdentifier('only-one')]]);
    expect(analyseNetwork('B00000099', reviews, hashes, corpus).productFinding.status).toBe('insufficient-data');
  });
});

// --- hijack / history ------------------------------------------------------

describe('rating-history analysis', () => {
  it('reports insufficient data on a first sighting', () => {
    corpus.recordObservation('B00000031', {
      displayedRating: 4.5, totalRatings: 900, titleHash: 'aaa', histogram: null,
    });
    expect(analyseHistory('B00000031', corpus)[0]!.status).toBe('insufficient-data');
  });

  it('flags a listing that changed product while keeping its reviews', () => {
    corpus.recordObservation('B00000032', {
      observedAt: '2026-01-01T00:00:00Z', displayedRating: 4.8, totalRatings: 5000, titleHash: 'phone-case', histogram: null,
    });
    corpus.recordObservation('B00000032', {
      observedAt: '2026-06-01T00:00:00Z', displayedRating: 4.8, totalRatings: 5100, titleHash: 'treadmill', histogram: null,
    });

    const hijack = analyseHistory('B00000032', corpus).find((f) => f.id === 'review-hijack')!;
    expect(hijack.status).toBe('fail');
    expect(hijack.detail).toMatch(/not buying/);
  });

  it('does not cry hijack when a listing legitimately starts fresh', () => {
    corpus.recordObservation('B00000033', {
      observedAt: '2026-01-01T00:00:00Z', displayedRating: 4.2, totalRatings: 12, titleHash: 'old', histogram: null,
    });
    corpus.recordObservation('B00000033', {
      observedAt: '2026-06-01T00:00:00Z', displayedRating: 4.4, totalRatings: 20, titleHash: 'new', histogram: null,
    });
    expect(analyseHistory('B00000033', corpus).find((f) => f.id === 'review-hijack')!.status).toBe('warn');
  });

  it('flags a rating that moved further than new ratings could explain', () => {
    corpus.recordObservation('B00000034', {
      observedAt: '2026-01-01T00:00:00Z', displayedRating: 3.6, totalRatings: 4000, titleHash: 'same', histogram: null,
    });
    corpus.recordObservation('B00000034', {
      observedAt: '2026-06-01T00:00:00Z', displayedRating: 4.7, totalRatings: 4100, titleHash: 'same', histogram: null,
    });

    const history = analyseHistory('B00000034', corpus).find((f) => f.id === 'rating-history')!;
    expect(history.status).toBe('warn');
    expect(history.evidence?.[0]).toMatch(/too few to move the average/);
  });

  it('passes a stable rating', () => {
    for (const [at, rating, count] of [
      ['2026-01-01T00:00:00Z', 4.4, 1000],
      ['2026-03-01T00:00:00Z', 4.4, 1200],
      ['2026-06-01T00:00:00Z', 4.5, 1500],
    ] as const) {
      corpus.recordObservation('B00000035', {
        observedAt: at, displayedRating: rating, totalRatings: count, titleHash: 'same', histogram: null,
      });
    }
    expect(analyseHistory('B00000035', corpus).find((f) => f.id === 'rating-history')!.status).toBe('pass');
  });
});

// --- retention -------------------------------------------------------------

describe('retention enforcement', () => {
  const monthsAgo = (n: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - n);
    return d.toISOString();
  };

  it('deletes reviewer data past the 24-month promise in PRIVACY.md', () => {
    corpus.upsertReview('B00000051', {
      reviewKey: 'old', rating: 5, date: '2023-01-01', verified: 1,
      helpfulVotes: 0, reviewerHash: hashIdentifier('stale'), wordCount: 30,
    });
    // Backdate the sighting to 30 months ago.
    const db = corpus as unknown as { db: { prepare(sql: string): { run(...p: unknown[]): unknown } } };
    db.db.prepare(`UPDATE reviews SET last_seen = ?, first_seen = ? WHERE review_key = 'old'`)
      .run(monthsAgo(30), monthsAgo(30));

    expect(corpus.pruneExpired().reviews).toBe(1);
    expect(corpus.asinsForReviewer(hashIdentifier('stale'))).toEqual([]);
  });

  it('keeps data inside the retention window', () => {
    corpus.upsertReview('B00000052', {
      reviewKey: 'fresh', rating: 5, date: '2026-06-01', verified: 1,
      helpfulVotes: 0, reviewerHash: hashIdentifier('active'), wordCount: 30,
    });
    expect(corpus.pruneExpired().reviews).toBe(0);
    expect(corpus.asinsForReviewer(hashIdentifier('active'))).toEqual(['B00000052']);
  });

  it('refreshes last_seen when a review is seen again, so active data is not aged out', () => {
    const row = {
      reviewKey: 'seen-again', rating: 5, date: '2026-01-01', verified: 1,
      helpfulVotes: 0, reviewerHash: hashIdentifier('recurring'), wordCount: 30,
    };
    corpus.upsertReview('B00000053', row);
    const db = corpus as unknown as { db: { prepare(sql: string): { run(...p: unknown[]): unknown } } };
    db.db.prepare(`UPDATE reviews SET last_seen = ? WHERE review_key = 'seen-again'`).run(monthsAgo(30));

    corpus.upsertReview('B00000053', { ...row, helpfulVotes: 4 }); // seen again today
    expect(corpus.pruneExpired().reviews).toBe(0);
  });

  it('drops stale observations and cached analyses', () => {
    corpus.recordObservation('B00000054', {
      observedAt: monthsAgo(30), displayedRating: 4.1, totalRatings: 500, titleHash: 'x', histogram: null,
    });
    expect(corpus.pruneExpired().observations).toBe(1);
  });
});

// --- orchestration ---------------------------------------------------------

describe('deep analysis orchestration', () => {
  const request = {
    contractVersion: 1 as const,
    asin: 'B00000041',
    displayedRating: 4.6,
    totalRatings: 2000,
    titleHash: 'abc123',
    reviews: [review({ id: 'r1' }), review({ id: 'r2', text: 'Another distinct review body here entirely.' })],
  };

  it('returns findings and records the observation', () => {
    const response = runDeepAnalysis(request, corpus);
    expect(response.asin).toBe('B00000041');
    expect(response.cached).toBe(false);
    expect(response.productFindings.length).toBeGreaterThan(0);
    expect(corpus.observationCount('B00000041')).toBe(1);
  });

  it('serves the second identical request from cache', () => {
    runDeepAnalysis(request, corpus);
    expect(runDeepAnalysis(request, corpus).cached).toBe(true);
  });

  it('invalidates the cache when the listing swaps product', () => {
    runDeepAnalysis(request, corpus);
    const swapped = runDeepAnalysis({ ...request, titleHash: 'totally-different' }, corpus);
    expect(swapped.cached).toBe(false);
  });

  it('derives a stable review key from content, not from DOM ids', () => {
    const a = reviewKeyFor(review({ id: 'dom-id-1', text: 'Same text', rating: 5, date: '2026-01-01' }));
    const b = reviewKeyFor(review({ id: 'dom-id-2', text: 'Same text', rating: 5, date: '2026-01-01' }));
    expect(a).toBe(b);
  });

  it('collapses repeat observations of an unchanged product', () => {
    for (let i = 0; i < 5; i++) runDeepAnalysis(request, corpus);
    expect(corpus.observationCount('B00000041')).toBe(1);
  });
});
