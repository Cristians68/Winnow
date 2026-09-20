/**
 * Turning a third party's JSON into something Winnow is willing to render.
 *
 * Treat everything arriving here as hostile. It is remote text controlled by
 * an advertiser and shaped by a network, and it is about to be placed inside a
 * privileged extension page. The rule this module enforces is the one the
 * Amazon parser learned the hard way, twice: a partial parse is worse than no
 * parse. A creative missing its advertiser name is an ad whose payer is
 * hidden, which is a worse outcome than an empty slot — so every validation
 * failure discards the entire creative rather than repairing it.
 */

import { isAllowedCreativeUrl, networkFor } from './registry.js';
import { buildAdRequest } from './policy.js';
import type { AdCreative, AdNetwork, AdProviderId, AdSlot } from './types.js';

/**
 * Length caps.
 *
 * These are layout limits, not security limits — but an unbounded headline is
 * a way to push Winnow's own UI off screen, so they are enforced by rejection
 * rather than by truncation. Truncating would let a network ship a creative
 * that reads differently than it was approved to read.
 */
export const MAX_HEADLINE = 80;
export const MAX_BODY = 140;
export const MAX_ADVERTISER = 40;

/**
 * Response fields that mean the network is trying to hand us behaviour rather
 * than content. Their presence rejects the whole creative — see the note in
 * normaliseCreative for why ignoring them is not good enough.
 */
export const BEHAVIOUR_FIELDS: readonly string[] = [
  'html',
  'script',
  'js',
  'javascript',
  'iframe',
  'embed',
  'onclick',
  'onload',
  'onerror',
  'srcdoc',
];

/** A string field that must be present, plain, and within its cap. */
function text(value: unknown, max: number): string | null {
  // Explicitly typeof, not truthiness: a number, an array or an object with a
  // toString would otherwise be coerced into something renderable.
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return null;
  return trimmed;
}

/** An optional URL field: absent is fine, present-but-hostile is not. */
function optionalUrl(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined; // undefined signals "reject"
  return isAllowedCreativeUrl(value) ? value : undefined;
}

/**
 * Validate one decoded ad response into a creative, or reject it outright.
 *
 * Returns null rather than throwing: a malformed ad is an ordinary condition,
 * not an error worth interrupting the popup for.
 */
export function normaliseCreative(provider: AdProviderId, raw: unknown): AdCreative | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;

  // Reject outright, rather than ignore, any field that offers behaviour.
  //
  // Building the creative field by field already stops these from rendering,
  // so this looks redundant — it is not. Ignoring them silently means the day
  // someone refactors this function into a spread of `source`, the extension
  // starts rendering advertiser-supplied HTML and every test still passes. A
  // network sending these has a contract that does not match ours, and the
  // useful time to find that out is now, loudly, not after a refactor.
  //
  // Unknown *benign* fields are still ignored: networks add optional fields
  // over time and breaking every install over one would be its own bug.
  if (BEHAVIOUR_FIELDS.some((field) => field in source)) return null;

  const headline = text(source.headline, MAX_HEADLINE);
  const advertiser = text(source.advertiser, MAX_ADVERTISER);
  // Body is the one genuinely optional string; an empty one renders as no line.
  const body = source.body === undefined || source.body === '' ? '' : text(source.body, MAX_BODY);

  if (!headline || !advertiser || body === null) return null;

  const clickUrl = typeof source.clickUrl === 'string' && isAllowedCreativeUrl(source.clickUrl)
    ? source.clickUrl
    : null;
  if (!clickUrl) return null;

  const imageUrl = optionalUrl(source.imageUrl);
  const viewUrl = optionalUrl(source.viewUrl);
  if (imageUrl === undefined || viewUrl === undefined) return null;

  // Built field by field, so no unexpected key — `html`, a tracking blob, a
  // nested object — can ride along on a spread of the source.
  return { provider, headline, body, advertiser, clickUrl, imageUrl, viewUrl };
}

/** Where to send a decision request for a given network. */
export function decisionUrl(network: AdNetwork): string {
  return `${network.origin}${network.path}`;
}

/** The request body for a slot. Page data cannot reach here; see policy.ts. */
export function decisionBody(slot: AdSlot): string {
  return JSON.stringify(buildAdRequest(slot));
}

/** Look up a provider's network, or null if it is not configured. */
export function providerFor(id: AdProviderId): AdNetwork | null {
  return networkFor(id);
}
