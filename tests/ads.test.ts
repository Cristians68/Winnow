import { describe, expect, it } from 'vitest';
import {
  AD_NETWORKS,
  activeNetworks,
  adMatchPatterns,
  isAllowedCreativeUrl,
  isKnownAdHost,
  networkFor,
} from '../src/shared/ads/registry.js';

/**
 * The ad host registry is the single place a host Winnow may talk to for
 * advertising is allowed to be named. It plays the same role for ad servers
 * that src/core/marketplaces.ts plays for storefronts, and for the same reason:
 * hosts that live in several files drift, and the drift is invisible until a
 * build ships a permission nobody decided to grant.
 */
describe('ad host registry', () => {
  it('produces one https match pattern per active network', () => {
    const patterns = adMatchPatterns();
    expect(patterns.length).toBe(activeNetworks().length);
    for (const pattern of patterns) {
      expect(pattern.startsWith('https://')).toBe(true);
      expect(pattern.endsWith('/*')).toBe(true);
    }
  });

  it('grants no host permission to an unconfigured network', () => {
    // A permission granted "for later" is a permission granted. PlayYield is
    // the live example: playyield.com serves a GoDaddy for-sale parking page
    // and the other TLDs do not resolve, so an install that carried its host
    // permission would hand whoever buys that domain next a foothold.
    const unconfigured = AD_NETWORKS.filter((network) => !network.configured);
    expect(unconfigured.length).toBeGreaterThan(0); // control: there is one to catch
    for (const network of unconfigured) {
      expect(adMatchPatterns()).not.toContain(`${network.origin}/*`);
      expect(isKnownAdHost(`${network.origin}/*`)).toBe(false);
      expect(networkFor(network.id)).toBe(null);
    }
  });

  it('never grants a plaintext http host', () => {
    // An ad creative arriving over http is a creative any network operator on
    // the path can rewrite, inside a product whose entire claim is that its
    // output cannot be bought.
    for (const network of AD_NETWORKS) {
      expect(network.origin.startsWith('https://')).toBe(true);
    }
  });

  it('recognises exactly the patterns it generated', () => {
    for (const pattern of adMatchPatterns()) {
      expect(isKnownAdHost(pattern)).toBe(true);
    }
  });

  it('rejects a lookalike host', () => {
    // The v0.4 packaging guard tested /amazon\./ unanchored and passed
    // `*://*.amazon.evil.com/*`. Exact-match or this registry has the same hole.
    expect(isKnownAdHost('https://ads.example.evil.com/*')).toBe(false);
    expect(isKnownAdHost('*://*/*')).toBe(false);
    expect(isKnownAdHost('')).toBe(false);
  });

  it('rejects a host permission that merely contains a known origin', () => {
    const [first] = AD_NETWORKS;
    expect(isKnownAdHost(`https://evil.com/?x=${first.origin}`)).toBe(false);
  });
});

describe('isAllowedCreativeUrl', () => {
  const origin = AD_NETWORKS[0].origin;

  it('accepts an https url on a registry origin', () => {
    expect(isAllowedCreativeUrl(`${origin}/creative/1.png`)).toBe(true);
  });

  it('refuses a script url', () => {
    // A creative field is remote text from a third party. If it can become a
    // javascript: navigation, the ad network can run code in the extension.
    expect(isAllowedCreativeUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedCreativeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('refuses plaintext http even on a registry origin', () => {
    expect(isAllowedCreativeUrl(origin.replace('https://', 'http://') + '/a.png')).toBe(false);
  });

  it('refuses an unknown host', () => {
    expect(isAllowedCreativeUrl('https://tracker.example.com/pixel.gif')).toBe(false);
  });

  it('refuses malformed input rather than guessing', () => {
    expect(isAllowedCreativeUrl('')).toBe(false);
    expect(isAllowedCreativeUrl('not a url')).toBe(false);
    expect(isAllowedCreativeUrl('//evil.com/a.png')).toBe(false);
  });
});

describe('networkFor', () => {
  it('finds a configured network by id', () => {
    const [first] = AD_NETWORKS;
    expect(networkFor(first.id)?.origin).toBe(first.origin);
  });

  it('returns null for an unknown id rather than a default', () => {
    // Falling back to "some network" would mean a typo silently routes ad
    // traffic somewhere nobody chose.
    expect(networkFor('playyield-unconfigured' as never)).toBe(null);
  });
});
