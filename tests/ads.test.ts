import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AD_NETWORKS,
  activeNetworks,
  adMatchPatterns,
  isAllowedCreativeUrl,
  isKnownAdHost,
  networkFor,
} from '../src/shared/ads/registry.js';
import { TEST_ORIGIN, clearTestNetwork, useTestNetwork } from './helpers/ad-fixture.js';

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
    const first = AD_NETWORKS[0]!;
    expect(isKnownAdHost(`https://evil.com/?x=${first.origin}`)).toBe(false);
  });
});

describe('isAllowedCreativeUrl', () => {
  // Uses the fixture network: every shipped network is configured:false, so
  // the real registry allows no creative URL at all right now. That is correct
  // behaviour and is asserted separately below, but it would make these cases
  // pass for the wrong reason.
  const origin = TEST_ORIGIN;
  beforeEach(() => useTestNetwork());
  afterEach(() => clearTestNetwork());

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
  beforeEach(() => useTestNetwork());
  afterEach(() => clearTestNetwork());

  it('finds a configured network by id', () => {
    const first = activeNetworks()[0]!;
    expect(networkFor(first.id)?.origin).toBe(first.origin);
  });

  it('returns null for an unknown id rather than a default', () => {
    // Falling back to "some network" would mean a typo silently routes ad
    // traffic somewhere nobody chose.
    expect(networkFor('playyield-unconfigured' as never)).toBe(null);
  });
});

/**
 * Invariants a network must satisfy before it may be contacted.
 *
 * Each of these is a mistake that has either happened here or came within one
 * edit of happening: a host permission to a domain somebody else owns, and a
 * network switched on before the credential it needs was filled in.
 */
describe('configured networks are actually usable', () => {
  it('never points at a placeholder domain', () => {
    // `.invalid` is reserved by RFC 2606 and can never resolve. Any network
    // still using one is an adapter waiting for a real endpoint, and must not
    // be carrying a host permission.
    for (const network of activeNetworks()) {
      expect(network.origin, `${network.id} is configured but points at a placeholder`)
        .not.toMatch(/\.invalid($|\/)/);
    }
  });

  it('has every required parameter filled in', () => {
    // EthicalAds will not serve without a publisher id. Flipping `configured`
    // without filling it would ship a host permission the build cannot use,
    // and an empty slot nobody could explain.
    for (const network of activeNetworks()) {
      for (const [key, value] of Object.entries(network.params)) {
        expect(value.trim(), `${network.id} is configured but ${key} is empty`).not.toBe('');
      }
    }
  });

  it('control: these invariants would reject the current placeholders', () => {
    // Every assertion above iterates activeNetworks(), which is empty while no
    // network is switched on — so all of them pass vacuously today. Prove the
    // rules themselves reject what they are meant to reject.
    const placeholders = AD_NETWORKS.filter((n) => /\.invalid($|\/)/.test(n.origin));
    expect(placeholders.length, 'no placeholder network left to check the rule against')
      .toBeGreaterThan(0);
    for (const network of placeholders) {
      expect(network.configured, `${network.id} is a placeholder AND configured`).toBe(false);
    }

    const unfilled = AD_NETWORKS.filter((n) => Object.values(n.params).some((v) => !v.trim()));
    for (const network of unfilled) {
      expect(network.configured, `${network.id} has an empty required param AND is configured`)
        .toBe(false);
    }
  });
});
