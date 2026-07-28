/**
 * Deep-signal liveness.
 *
 * The companion to tests/liveness.test.ts in the extension package, and the
 * direct consequence of the bug that motivated both: cross-product template
 * reuse shipped unable to fire in normal use, and every existing test passed
 * because every existing fixture happened to construct the one condition that
 * unblocked it.
 *
 * All three deep signals depend on corpus state accumulated over time, which is
 * exactly the kind of precondition that is easy to satisfy accidentally in a
 * fixture and almost never satisfied in production. So each one gets:
 *
 *   · a case built the way real traffic would build it, which must fire
 *   · a clean case, which must not
 *
 * "Built the way real traffic would" is the load-bearing part. A fixture that
 * reaches for the shortest path to a positive result is how the original defect
 * hid for a full build.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Corpus } from '../src/db.ts';
import { hashIdentifier, saltFingerprint, HASH_SALT } from '../src/privacy.ts';
import { analyseText, contributeShingles, shingleHashes } from '../src/signals/aitext.ts';
import { analyseNetwork, contributeReviewers } from '../src/signals/network.ts';
import { analyseHistory } from '../src/signals/hijack.ts';
import { reviewKeyFor } from '../src/deep.ts';
import type { WireReview } from '../src/contract.ts';

let corpus: Corpus;
beforeEach(() => {
  corpus = new Corpus(':memory:');
});

function review(partial: Partial<WireReview> & { id: string }): WireReview {
  return {
    rating: 5,
    verified: true,
    date: '2026-05-01',
    text: 'A perfectly ordinary review carrying a reasonable amount of specific detail about the product.',
    helpfulVotes: 2,
    ...partial,
  };
}

const hashesFor = (reviews: WireReview[]) =>
  new Map(reviews.filter((r) => r.reviewerId).map((r) => [r.id, hashIdentifier(r.reviewerId!)]));

// --- cross-product template reuse -----------------------------------------

describe('cross-product template reuse liveness', () => {
  const TEMPLATE =
    'i was really impressed with this item from the moment i opened the box the build quality feels premium and solid';

  it('fires on a template spread by ordinary traffic — each product seen once, on its own day', () => {
    // The realistic shape: different users, different products, different days,
    // nobody visiting the same listing twice. This is the case the original
    // pair-wise corroboration rule made impossible to detect.
    ['B00LIVE001', 'B00LIVE002', 'B00LIVE003', 'B00LIVE004'].forEach((asin, i) => {
      corpus.recordShingles(asin, shingleHashes(TEMPLATE), `2026-07-0${i + 1}`);
    });

    const result = analyseText('B00LIVE009', [review({ id: 'target', text: TEMPLATE })], corpus);
    expect(result.templatedReviewCount).toBeGreaterThan(0);
    expect(result.findings[0]!.source).toBe('cross-product-template');
    expect(result.findings[0]!.delta).toBeGreaterThan(0);
  });

  it('stays silent on text that is genuinely this product’s own', () => {
    ['B00LIVE001', 'B00LIVE002', 'B00LIVE003', 'B00LIVE004'].forEach((asin, i) => {
      corpus.recordShingles(asin, shingleHashes(TEMPLATE), `2026-07-0${i + 1}`);
    });

    const original = review({
      id: 'target',
      text: 'The hinge cracked after about 7 weeks of opening it twice a day, which for £30 I think is fair enough honestly.',
    });
    expect(analyseText('B00LIVE009', [original], corpus).templatedReviewCount).toBe(0);
  });
});

// --- reviewer networks -----------------------------------------------------

describe('reviewer network liveness', () => {
  const ringReviews = (asin: string) =>
    Array.from({ length: 6 }, (_, i) =>
      review({
        id: `${asin}-r${i}`,
        reviewerId: `ring-member-${i}`,
        text: `Solid product, does the job well, review number ${i} for ${asin} with enough words to count.`,
      }),
    );

  it('fires when the same handful of reviewers appear across unrelated products', () => {
    for (const asin of ['B00RING001', 'B00RING002', 'B00RING003', 'B00RING004']) {
      const reviews = ringReviews(asin);
      contributeReviewers(asin, reviews, hashesFor(reviews), corpus, reviewKeyFor);
    }

    const target = ringReviews('B00RING009');
    const result = analyseNetwork('B00RING009', target, hashesFor(target), corpus);
    expect(result.productFinding.status).toBe('fail');
    expect(result.reviewFindings.length).toBeGreaterThan(0);
  });

  it('stays silent when reviewers have no history in common', () => {
    for (const asin of ['B00SOLO001', 'B00SOLO002', 'B00SOLO003']) {
      const reviews = Array.from({ length: 6 }, (_, i) =>
        review({ id: `${asin}-r${i}`, reviewerId: `${asin}-person-${i}`, text: `Independent review ${i} for ${asin} here.` }),
      );
      contributeReviewers(asin, reviews, hashesFor(reviews), corpus, reviewKeyFor);
    }

    const target = Array.from({ length: 6 }, (_, i) =>
      review({ id: `t-r${i}`, reviewerId: `stranger-${i}`, text: `Unconnected review ${i} written by a stranger.` }),
    );
    expect(analyseNetwork('B00SOLO009', target, hashesFor(target), corpus).productFinding.status).not.toBe('fail');
  });
});

// --- salt continuity -------------------------------------------------------

/**
 * The operational version of a dead signal.
 *
 * Reviewer hashes are only comparable to each other while the salt stays put.
 * Lose WINNOW_HASH_SALT on a restart and every stored hash becomes unmatchable,
 * so the reviewer-network signal reports "no unusual overlap" about a corpus it
 * can no longer read. That reads identically to a clean product.
 */
describe('reviewer-id salt continuity', () => {
  it('records the fingerprint on first use and stays quiet', () => {
    expect(corpus.checkSaltFingerprint('fingerprint-a')).toBeNull();
    expect(corpus.checkSaltFingerprint('fingerprint-a')).toBeNull();
  });

  it('reports a changed salt, and how many reviewers it orphaned', () => {
    const reviews = Array.from({ length: 4 }, (_, i) =>
      review({ id: `r${i}`, reviewerId: `person-${i}`, text: `A review with enough words in it, number ${i}.` }),
    );
    contributeReviewers('B00SALT001', reviews, hashesFor(reviews), corpus, reviewKeyFor);

    expect(corpus.checkSaltFingerprint('fingerprint-a')).toBeNull();

    const drift = corpus.checkSaltFingerprint('fingerprint-b');
    expect(drift).toEqual({ changed: true, orphanedReviewers: 4 });
  });

  it('warns once per transition rather than on every boot', () => {
    corpus.checkSaltFingerprint('fingerprint-a');
    expect(corpus.checkSaltFingerprint('fingerprint-b')?.changed).toBe(true);
    // Same salt as the previous boot now — nothing further to report.
    expect(corpus.checkSaltFingerprint('fingerprint-b')).toBeNull();
  });

  it('derives a fingerprint that reveals nothing about the salt itself', () => {
    const fingerprint = saltFingerprint();
    expect(fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprint).not.toContain(HASH_SALT);
    expect(HASH_SALT).not.toContain(fingerprint);
  });
});

// --- review hijacking and rating history -----------------------------------

describe('rating history liveness', () => {
  const observe = (asin: string, o: { rating: number; total: number; title: string; at: string }) =>
    corpus.recordObservation(asin, {
      observedAt: o.at,
      displayedRating: o.rating,
      totalRatings: o.total,
      titleHash: o.title,
      histogram: null,
    });

  it('fires when a listing swaps product while keeping its ratings', () => {
    observe('B00HIJK001', { rating: 4.8, total: 4200, title: 'phone-case-hash', at: '2026-03-01T00:00:00.000Z' });
    observe('B00HIJK001', { rating: 4.8, total: 4250, title: 'treadmill-hash', at: '2026-06-01T00:00:00.000Z' });

    const findings = analyseHistory('B00HIJK001', corpus);
    const hijack = findings.find((f) => f.id === 'review-hijack');
    expect(hijack?.status).toBe('fail');
    expect(hijack?.evidence?.join(' ')).toMatch(/carried over/);
  });

  it('fires when an established average moves further than new ratings can explain', () => {
    observe('B00SHFT001', { rating: 3.9, total: 2000, title: 'same-hash', at: '2026-03-01T00:00:00.000Z' });
    observe('B00SHFT001', { rating: 4.6, total: 2050, title: 'same-hash', at: '2026-04-01T00:00:00.000Z' });
    observe('B00SHFT001', { rating: 3.9, total: 2090, title: 'same-hash', at: '2026-05-01T00:00:00.000Z' });

    const history = analyseHistory('B00SHFT001', corpus).find((f) => f.id === 'rating-history');
    expect(history?.status).toBe('fail');
    expect(history?.evidence?.join(' ')).toMatch(/too few to move the average/);
  });

  it('stays silent on a listing that has sold the same thing at a stable rating', () => {
    observe('B00CALM001', { rating: 4.3, total: 1000, title: 'same-hash', at: '2026-03-01T00:00:00.000Z' });
    observe('B00CALM001', { rating: 4.3, total: 1400, title: 'same-hash', at: '2026-04-01T00:00:00.000Z' });

    for (const finding of analyseHistory('B00CALM001', corpus)) {
      expect(finding.status).toBe('pass');
    }
  });

  // The honest-degradation rule: one sighting is not evidence of stability.
  it('reports insufficient data rather than a clean bill of health on first sighting', () => {
    observe('B00ONCE001', { rating: 4.3, total: 1000, title: 'same-hash', at: '2026-03-01T00:00:00.000Z' });
    const findings = analyseHistory('B00ONCE001', corpus);
    expect(findings.every((f) => f.status === 'insufficient-data')).toBe(true);
  });
});
