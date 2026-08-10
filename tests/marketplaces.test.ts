import { describe, it, expect } from 'vitest';
import { MARKETPLACES, marketplaceFor, matchPatterns, isKnownAmazonHost } from '../src/core/marketplaces.js';
import { MONTH_NAMES } from '../src/core/language.js';

describe('marketplace registry', () => {
  it('resolves a storefront from a hostname, including www and subdomains', () => {
    expect(marketplaceFor('www.amazon.co.jp')?.host).toBe('amazon.co.jp');
    expect(marketplaceFor('amazon.co.jp')?.host).toBe('amazon.co.jp');
    expect(marketplaceFor('smile.amazon.com')?.host).toBe('amazon.com');
  });

  // The guard this replaces was an unanchored /amazon\./, which passes every
  // one of these. A privacy product whose pitch is "these are the only hosts it
  // can reach" cannot ship that.
  it('refuses lookalike and unrelated hosts', () => {
    for (const host of ['amazon.evil.com', 'notamazon.com', 'amazon.com.evil.net', 'evil.net']) {
      expect(marketplaceFor(host), host).toBeNull();
    }
  });

  it('prefers the longest matching host so co.uk never resolves to com', () => {
    expect(marketplaceFor('www.amazon.com.au')?.host).toBe('amazon.com.au');
    expect(marketplaceFor('www.amazon.co.uk')?.host).toBe('amazon.co.uk');
  });

  it('emits one match pattern per storefront', () => {
    const patterns = matchPatterns();
    expect(patterns).toHaveLength(MARKETPLACES.length);
    expect(patterns).toContain('*://*.amazon.co.jp/*');
  });

  it('accepts only patterns built from the registry', () => {
    expect(isKnownAmazonHost('*://*.amazon.de/*')).toBe(true);
    expect(isKnownAmazonHost('*://*.amazon.evil.com/*')).toBe(false);
    expect(isKnownAmazonHost('*://*.evil.com/*')).toBe(false);
    expect(isKnownAmazonHost('<all_urls>')).toBe(false);
  });

  // This is the assertion that makes the v0.3.0 localisation bug impossible to
  // repeat: a storefront cannot exist without the locale tables it needs.
  it('every storefront names languages the engine has month tables for', () => {
    for (const market of MARKETPLACES) {
      expect(market.languages.length, market.host).toBeGreaterThan(0);
      for (const language of market.languages) {
        expect(MONTH_NAMES[language], `${market.host} declares ${language}`).toBeDefined();
      }
    }
  });

  it('has no duplicate hosts', () => {
    const hosts = MARKETPLACES.map((m) => m.host);
    expect(new Set(hosts).size).toBe(hosts.length);
  });
});
