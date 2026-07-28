/**
 * Request sanitisation.
 *
 * This module is the reason the privacy policy can make an absolute claim. It
 * does not merely ignore unexpected fields — it **rejects** requests carrying
 * them. If a future client accidentally starts sending a user id, session
 * token, or email, the server refuses the request loudly instead of quietly
 * storing it.
 *
 * Reviewer ids are HMAC-hashed with a server-side salt before they touch the
 * database, so the corpus can link a reviewer's activity across products
 * without ever holding Amazon's public identifiers in the clear.
 */

import { createHmac, randomBytes } from 'node:crypto';
import type { DeepAnalysisRequest, WireReview } from './contract.ts';
import { CONTRACT_VERSION } from './contract.ts';

/** Caps that bound both abuse and accidental oversharing. */
export const LIMITS = {
  maxReviews: 60,
  maxTextChars: 6000,
  maxAsinLength: 10,
  maxBodyBytes: 512 * 1024,
} as const;

const REQUEST_FIELDS = new Set([
  'contractVersion',
  'asin',
  'displayedRating',
  'totalRatings',
  'histogram',
  'titleHash',
  'reviews',
]);

const REVIEW_FIELDS = new Set(['id', 'rating', 'date', 'verified', 'text', 'helpfulVotes', 'reviewerId']);

export class RejectedRequest extends Error {
  // Written out longhand rather than as a TypeScript parameter property: Node
  // runs this file directly via type stripping, which rejects that syntax.
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'RejectedRequest';
    this.reason = reason;
  }
}

/**
 * The salt used to hash reviewer ids. Supplied via WINNOW_HASH_SALT in
 * production; a random per-process salt is generated otherwise, which
 * deliberately makes a dev server's corpus non-portable rather than silently
 * using a guessable default.
 */
export const HASH_SALT: string = process.env.WINNOW_HASH_SALT ?? randomBytes(32).toString('hex');

/** True when the salt is ephemeral, so the corpus will not survive a restart. */
export const SALT_IS_EPHEMERAL: boolean = process.env.WINNOW_HASH_SALT === undefined;

export function hashIdentifier(value: string): string {
  return createHmac('sha256', HASH_SALT).update(value).digest('hex').slice(0, 32);
}

/**
 * A value derived from the salt that can be stored and compared, without the
 * salt itself ever touching the database. Hashing a fixed string under the same
 * HMAC means an identical salt yields an identical fingerprint and a changed
 * salt yields a different one, which is all the boot check needs.
 */
export function saltFingerprint(): string {
  return hashIdentifier('winnow:salt-continuity-probe');
}

function assert(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new RejectedRequest(reason);
}

function rejectUnknownFields(object: object, allowed: Set<string>, where: string): void {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      throw new RejectedRequest(`unexpected field "${key}" in ${where}`);
    }
  }
}

function sanitiseReview(raw: unknown, index: number): WireReview {
  assert(raw && typeof raw === 'object', `review ${index} is not an object`);
  const review = raw as Record<string, unknown>;
  rejectUnknownFields(review, REVIEW_FIELDS, `review ${index}`);

  assert(typeof review.id === 'string' && review.id.length <= 128, `review ${index} has an invalid id`);
  assert(
    typeof review.rating === 'number' && Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 5,
    `review ${index} has an invalid rating`,
  );
  assert(typeof review.verified === 'boolean', `review ${index} has an invalid verified flag`);
  assert(typeof review.text === 'string', `review ${index} has invalid text`);
  assert(
    typeof review.helpfulVotes === 'number' && Number.isFinite(review.helpfulVotes) && review.helpfulVotes >= 0,
    `review ${index} has invalid helpfulVotes`,
  );

  if (review.date !== undefined) {
    assert(typeof review.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(review.date), `review ${index} has an invalid date`);
  }
  if (review.reviewerId !== undefined) {
    assert(typeof review.reviewerId === 'string' && review.reviewerId.length <= 128, `review ${index} has an invalid reviewerId`);
  }

  return {
    id: review.id,
    rating: review.rating as WireReview['rating'],
    date: review.date as string | undefined,
    verified: review.verified,
    text: (review.text as string).slice(0, LIMITS.maxTextChars),
    helpfulVotes: Math.min(review.helpfulVotes as number, 1_000_000),
    reviewerId: review.reviewerId as string | undefined,
  };
}

export function sanitiseRequest(raw: unknown): DeepAnalysisRequest {
  assert(raw && typeof raw === 'object' && !Array.isArray(raw), 'body must be a JSON object');
  const body = raw as Record<string, unknown>;
  rejectUnknownFields(body, REQUEST_FIELDS, 'request');

  assert(body.contractVersion === CONTRACT_VERSION, `unsupported contractVersion (expected ${CONTRACT_VERSION})`);
  assert(
    typeof body.asin === 'string' && /^[A-Z0-9]{10}$/i.test(body.asin),
    'asin must be a 10-character alphanumeric string',
  );
  assert(Array.isArray(body.reviews), 'reviews must be an array');
  assert(body.reviews.length <= LIMITS.maxReviews, `too many reviews (max ${LIMITS.maxReviews})`);

  if (body.displayedRating !== undefined) {
    assert(
      typeof body.displayedRating === 'number' && body.displayedRating >= 1 && body.displayedRating <= 5,
      'displayedRating out of range',
    );
  }
  if (body.totalRatings !== undefined) {
    assert(
      typeof body.totalRatings === 'number' && Number.isFinite(body.totalRatings) && body.totalRatings >= 0,
      'totalRatings must be a non-negative number',
    );
  }
  if (body.titleHash !== undefined) {
    assert(typeof body.titleHash === 'string' && /^[a-f0-9]{1,64}$/i.test(body.titleHash), 'titleHash must be a hex digest');
  }
  if (body.histogram !== undefined) {
    assert(body.histogram && typeof body.histogram === 'object', 'histogram must be an object');
    for (const [star, value] of Object.entries(body.histogram as object)) {
      assert(/^[1-5]$/.test(star), `histogram has an invalid key "${star}"`);
      assert(typeof value === 'number' && value >= 0 && value <= 100, `histogram value for ${star} is out of range`);
    }
  }

  return {
    contractVersion: CONTRACT_VERSION,
    asin: (body.asin as string).toUpperCase(),
    displayedRating: body.displayedRating as number | undefined,
    totalRatings: body.totalRatings as number | undefined,
    histogram: body.histogram as DeepAnalysisRequest['histogram'],
    titleHash: body.titleHash as string | undefined,
    reviews: (body.reviews as unknown[]).map(sanitiseReview),
  };
}
