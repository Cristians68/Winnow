import { describe, it, expect } from 'vitest';
import { sanitiseRequest, hashIdentifier, RejectedRequest, LIMITS } from '../src/privacy.ts';
import { isAllowedOrigin } from '../src/http.ts';

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 1,
    asin: 'B08N5WRWNW',
    displayedRating: 4.3,
    totalRatings: 1200,
    reviews: [
      { id: 'r1', rating: 5, date: '2026-06-01', verified: true, text: 'Good product.', helpfulVotes: 3 },
    ],
    ...overrides,
  };
}

describe('request sanitisation', () => {
  it('accepts a well-formed request', () => {
    const result = sanitiseRequest(validBody());
    expect(result.asin).toBe('B08N5WRWNW');
    expect(result.reviews).toHaveLength(1);
  });

  // The central privacy guarantee: unknown fields are REJECTED, not ignored.
  // If a future client accidentally starts sending identity, the server must
  // refuse loudly rather than quietly persist it.
  it('rejects unknown top-level fields rather than dropping them', () => {
    for (const field of ['userId', 'email', 'sessionToken', 'ip', 'deviceId', 'cookies']) {
      expect(() => sanitiseRequest(validBody({ [field]: 'x' }))).toThrow(RejectedRequest);
      expect(() => sanitiseRequest(validBody({ [field]: 'x' }))).toThrow(/unexpected field/);
    }
  });

  it('rejects unknown fields inside a review', () => {
    const body = validBody({
      reviews: [{ id: 'r1', rating: 5, verified: true, text: 'x', helpfulVotes: 0, userEmail: 'a@b.c' }],
    });
    expect(() => sanitiseRequest(body)).toThrow(/unexpected field "userEmail"/);
  });

  it('rejects a malformed ASIN', () => {
    expect(() => sanitiseRequest(validBody({ asin: '../../etc/passwd' }))).toThrow(/asin/);
    expect(() => sanitiseRequest(validBody({ asin: 'SHORT' }))).toThrow(/asin/);
  });

  it('rejects an unsupported contract version', () => {
    expect(() => sanitiseRequest(validBody({ contractVersion: 99 }))).toThrow(/contractVersion/);
  });

  it('rejects out-of-range values', () => {
    expect(() => sanitiseRequest(validBody({ displayedRating: 9 }))).toThrow(/displayedRating/);
    expect(() => sanitiseRequest(validBody({ totalRatings: -5 }))).toThrow(/totalRatings/);
    expect(() => sanitiseRequest(validBody({ histogram: { 5: 400 } }))).toThrow(/histogram/);
    expect(() => sanitiseRequest(validBody({ histogram: { 9: 10 } }))).toThrow(/invalid key/);
  });

  it('rejects more reviews than the cap allows', () => {
    const reviews = Array.from({ length: LIMITS.maxReviews + 1 }, (_, i) => ({
      id: `r${i}`, rating: 5, verified: true, text: 'x', helpfulVotes: 0,
    }));
    expect(() => sanitiseRequest(validBody({ reviews }))).toThrow(/too many reviews/);
  });

  it('truncates oversized review text instead of storing it whole', () => {
    const body = validBody({
      reviews: [{ id: 'r1', rating: 5, verified: true, text: 'a'.repeat(50_000), helpfulVotes: 0 }],
    });
    expect(sanitiseRequest(body).reviews[0]!.text.length).toBe(LIMITS.maxTextChars);
  });

  it('rejects a non-object body', () => {
    expect(() => sanitiseRequest([])).toThrow(/JSON object/);
    expect(() => sanitiseRequest('nope')).toThrow(/JSON object/);
    expect(() => sanitiseRequest(null)).toThrow(/JSON object/);
  });

  it('rejects an invalid date format', () => {
    const body = validBody({
      reviews: [{ id: 'r1', rating: 5, verified: true, text: 'x', helpfulVotes: 0, date: 'June 2026' }],
    });
    expect(() => sanitiseRequest(body)).toThrow(/date/);
  });
});

describe('identifier hashing', () => {
  it('is deterministic and does not leak the input', () => {
    const id = 'amzn1.account.ABC123';
    expect(hashIdentifier(id)).toBe(hashIdentifier(id));
    expect(hashIdentifier(id)).not.toContain('ABC123');
    expect(hashIdentifier(id)).toMatch(/^[a-f0-9]{32}$/);
  });

  it('separates distinct reviewers', () => {
    expect(hashIdentifier('a')).not.toBe(hashIdentifier('b'));
  });
});

describe('CORS origin policy', () => {
  it('allows extension origins', () => {
    expect(isAllowedOrigin('chrome-extension://abcdefghijklmnop')).toBe(true);
    expect(isAllowedOrigin('moz-extension://abcdefghijklmnop')).toBe(true);
  });

  it('refuses web origins, which must never call this API', () => {
    for (const origin of [
      'https://evil.example',
      'https://www.amazon.com',
      'http://localhost:3000',
      'chrome-extension://abc/../..',
      'null',
    ]) {
      expect(isAllowedOrigin(origin)).toBe(false);
    }
  });
});
