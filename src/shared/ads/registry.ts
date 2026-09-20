/**
 * The only place an advertising host may be named.
 *
 * This is the ad-side twin of src/core/marketplaces.ts, and it exists for the
 * reason recorded there: Amazon hosts once lived in five drifting places, and
 * the drift was invisible until a build shipped reach nobody had decided to
 * grant. Winnow has already paid for that mistake once in a worse form — an
 * earlier build carried a standing host permission to `api.winnow.app`, a
 * domain owned by somebody else and parked. Nothing leaked, because the
 * subdomain happened not to resolve. That is luck, not design.
 *
 * So: build.mjs generates the manifest from this list, package.mjs refuses to
 * zip a build whose host permissions this list did not produce, and a network
 * that is not `configured` gets neither.
 */

import type { AdNetwork, AdProviderId } from './types.js';

/**
 * Configured ad networks.
 *
 * `configured: false` means the adapter exists but no verified endpoint does.
 * Such a network is never granted a host permission and never fetched. This is
 * not caution for its own sake: `playyield.com` currently serves a GoDaddy
 * for-sale parking page, and playyield.io/.net/.ai/.co/.org do not resolve at
 * all. Granting a host permission to a parked domain inside a privacy
 * extension hands whoever buys it next a foothold in every install. Flip
 * `configured` to true only after fetching the real endpoint and reading its
 * response format — not on the strength of a network's marketing page.
 */
export const AD_NETWORKS: readonly AdNetwork[] = [
  {
    id: 'ethical',
    origin: 'https://server.ethicalads.io',
    path: '/api/v1/decision/',
    label: 'EthicalAds',
    // Privacy-first by construction: no cookies, no cross-site tracking, no
    // user profile. It is the only widely-available network whose data model
    // does not contradict this extension's privacy policy.
    configured: true,
  },
  {
    id: 'playyield',
    // Adapter only. See the note above: this domain is parked and for sale.
    // Left here so wiring a real endpoint is a one-line change plus a test,
    // rather than a rediscovery of this entire design.
    origin: 'https://api.playyield.invalid',
    path: '/v1/ad',
    label: 'PlayYield',
    configured: false,
  },
];

/** Networks that may actually be contacted. */
export function activeNetworks(): AdNetwork[] {
  return AD_NETWORKS.filter((network) => network.configured);
}

/**
 * Manifest match patterns, one per *configured* network.
 *
 * An unconfigured adapter contributes no permission. A permission granted "for
 * later" is a permission granted.
 */
export function adMatchPatterns(): string[] {
  return activeNetworks().map((network) => `${network.origin}/*`);
}

/**
 * Whether a manifest host pattern is one this registry would have produced.
 *
 * Exact match against the generated list. The guard this mirrors was once an
 * unanchored `/amazon\./`, which passed `*://*.amazon.evil.com/*`; a substring
 * or regex test here would reopen precisely that hole on the ad side.
 */
export function isKnownAdHost(pattern: string): boolean {
  return adMatchPatterns().includes(pattern);
}

/** Look up a configured network. Unknown ids return null rather than a default. */
export function networkFor(id: AdProviderId): AdNetwork | null {
  return activeNetworks().find((network) => network.id === id) ?? null;
}

/**
 * Whether a URL from a creative may be loaded or navigated to.
 *
 * Creative fields are attacker-controlled text as far as this extension is
 * concerned: they arrive from a third party over the network. A URL that fails
 * any of these checks is dropped and the whole creative is discarded, because
 * a partial parse is worse than no parse — a lesson this codebase learned
 * twice on the Amazon side.
 */
export function isAllowedCreativeUrl(url: string): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Relative and protocol-relative URLs land here. Both would resolve
    // against whatever page happens to host the slot, which is not a decision
    // an ad network gets to make.
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return activeNetworks().some((network) => parsed.origin === network.origin);
}
