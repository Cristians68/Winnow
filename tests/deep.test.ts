import { describe, it, expect } from 'vitest';
import { buildRequest, toAugmentation, hashTitle, type DeepAnalysisResponse } from '../src/shared/deep.js';
import { analyse } from '../src/core/score.js';
import type { ProductSnapshot, Star } from '../src/core/types.js';
// Cross-package on purpose: the client payload is validated against the very
// sanitiser the real server uses, so a leak cannot pass unnoticed.
import { sanitiseRequest } from '../server/src/privacy.ts';

function snapshot(partial: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    asin: 'B08N5WRWNW',
    title: 'Test Headphones',
    displayedRating: 4.6,
    totalRatings: 2000,
    histogram: { 5: 80, 4: 10, 3: 4, 2: 3, 1: 3 },
    reviews: [
      {
        id: 'r1',
        rating: 5 as Star,
        date: '2026-06-01',
        verified: true,
        text: 'Sound quality is good for the price, though the case creaks.',
        helpfulVotes: 4,
        reviewerId: 'amzn1.account.ABC',
        reviewerName: 'Jane D.',
      },
    ],
    capturedAt: new Date().toISOString(),
    ...partial,
  };
}

describe('deep-analysis request construction', () => {
  it('produces a payload the real server accepts', async () => {
    const payload = await buildRequest(snapshot());
    expect(() => sanitiseRequest(payload)).not.toThrow();
  });

  // The snapshot carries reviewerName, which is a person's display name and has
  // no business leaving the browser. Building the payload field by field rather
  // than by spreading is what keeps it out — this test pins that.
  it('never transmits the reviewer display name', async () => {
    const payload = await buildRequest(snapshot());
    expect(JSON.stringify(payload)).not.toContain('Jane D.');
    expect(JSON.stringify(payload)).not.toContain('reviewerName');
  });

  it('sends a hash of the product title, never the title itself', async () => {
    const payload = await buildRequest(snapshot());
    expect(JSON.stringify(payload)).not.toContain('Test Headphones');
    expect(payload.titleHash).toMatch(/^[a-f0-9]{32}$/);
  });

  it('hashes titles deterministically and distinguishes different ones', async () => {
    expect(await hashTitle('Widget A')).toBe(await hashTitle('widget a  '));
    expect(await hashTitle('Widget A')).not.toBe(await hashTitle('Widget B'));
  });

  it('omits optional fields cleanly when the page did not expose them', async () => {
    const payload = await buildRequest(
      snapshot({ title: undefined, displayedRating: undefined, histogram: undefined, totalRatings: undefined }),
    );
    expect(() => sanitiseRequest(payload)).not.toThrow();
    expect(payload.titleHash).toBeUndefined();
  });
});

describe('folding deep findings into the local grade', () => {
  const response: DeepAnalysisResponse = {
    contractVersion: 1,
    asin: 'B08N5WRWNW',
    reviewFindings: [
      { reviewId: 'r1', delta: 0.6, reason: 'Phrasing seen on 7 other products', source: 'cross-product-template' },
    ],
    productFindings: [
      { id: 'review-hijack', label: 'Listing changes', status: 'fail', detail: 'Listing changed product.' },
      { id: 'reviewer-network', label: 'Reviewer network', status: 'insufficient-data', detail: 'Too few profiles.' },
    ],
    corpusObservations: 4,
    cached: false,
    computedAt: new Date().toISOString(),
  };

  it('lowers the grade once server evidence is included', () => {
    const before = analyse(snapshot());
    const after = analyse(snapshot(), toAugmentation(response));
    expect(after.trustScore).toBeLessThan(before.trustScore);
  });

  it('surfaces server findings as inspectable signals', () => {
    const after = analyse(snapshot(), toAugmentation(response));
    const hijack = after.signals.find((s) => s.id === 'deep:review-hijack');
    expect(hijack?.status).toBe('fail');
    expect(hijack?.detail).toBe('Listing changed product.');
  });

  it('gives insufficient-data findings zero weight rather than treating them as clean', () => {
    const augmentation = toAugmentation(response);
    const network = augmentation.signals.find((s) => s.id === 'deep:reviewer-network');
    expect(network?.confidence).toBe(0);
  });

  it('attributes the reason to the specific review', () => {
    const after = analyse(snapshot(), toAugmentation(response));
    expect(after.assessments[0]!.reasons).toContain('Phrasing seen on 7 other products');
  });

  it('ignores findings for reviews absent from the page', () => {
    const stray = { ...response, reviewFindings: [{ ...response.reviewFindings[0]!, reviewId: 'ghost' }] };
    expect(() => analyse(snapshot(), toAugmentation(stray))).not.toThrow();
  });
});
