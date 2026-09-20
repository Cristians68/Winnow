/**
 * What an ad request is permitted to contain.
 *
 * The whole ad design rests on one property: the network cannot learn what the
 * slot is next to. Winnow's pitch is that its grades cannot be bought, and a
 * network that receives the ASIN can sell targeting against that ASIN — at
 * which point independence is something we assert rather than something the
 * wire format enforces.
 *
 * This module is small on purpose. It is the only builder of ad requests, it
 * takes no snapshot, no analysis and no tab, and it therefore *cannot* include
 * page data — not as a matter of discipline but because nothing here has
 * access to any. tests/ads-policy.test.ts pins the key set so that a future
 * edit adding a field fails the suite instead of shipping.
 */

import type { AdFormat, AdRequest, AdSlot } from './types.js';

/**
 * Formats Winnow can render.
 *
 * Note what is absent: 'html' and 'script'. A network that can only send us
 * fields cannot send us behaviour, and MV3's default script-src 'self' means
 * a remote script could not execute in an extension page even if one arrived.
 */
export const ACCEPTED_FORMATS: readonly AdFormat[] = ['text', 'image'];

/**
 * Every key an ad request may carry.
 *
 * Kept as data, not derived from a sample object, so the test compares the
 * implementation against a deliberately written list rather than against
 * itself. A check derived from the thing it checks cannot fail.
 */
export const AD_REQUEST_KEYS: readonly string[] = ['v', 'slot', 'formats'];

/**
 * Build the complete ad request.
 *
 * Takes only the slot. There is deliberately no parameter through which page
 * context could be passed, and no clock read or random value, so two installs
 * asking for the same slot send byte-identical bodies — a request that varied
 * per install would be a fingerprint no matter what the fields were called.
 */
export function buildAdRequest(slot: AdSlot): AdRequest {
  return { v: 1, slot, formats: ACCEPTED_FORMATS };
}
