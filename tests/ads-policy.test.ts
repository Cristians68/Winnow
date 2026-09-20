import { describe, expect, it } from 'vitest';
import { AD_REQUEST_KEYS, buildAdRequest } from '../src/shared/ads/policy.js';

/**
 * This suite is the ad system's central promise, written as a test.
 *
 * Winnow tells people its grades cannot be bought. An ad slot inside that
 * product is only defensible if the ad network is structurally unable to learn
 * what it is sitting next to — because a network that knows the ASIN can
 * target the advertiser to the product, and at that point "the verdict is
 * independent of the advertising" becomes a claim resting on our restraint
 * rather than on the wire format.
 *
 * So the assertion is not "we currently send little". It is "the key set is
 * exactly this, and adding to it fails the build".
 */

/** Things that must never appear in an ad request, in any encoding. */
const FORBIDDEN = {
  asin: 'B0CXXXXXXX',
  title: 'Acme Wireless Earbuds Pro',
  grade: 'F',
  trustScore: '36',
  url: 'https://www.amazon.com/dp/B0CXXXXXXX',
  reviewText: 'These earbuds changed my life',
  reviewer: 'Amazon Customer',
};

describe('ad request policy', () => {
  it('sends exactly the declared key set and nothing else', () => {
    // If someone adds a field to AdRequest, this fails. That is the point:
    // the leak is caught by the suite rather than by a user reading a network
    // tab six months from now.
    expect(Object.keys(buildAdRequest('popup')).sort()).toEqual([...AD_REQUEST_KEYS].sort());
  });

  it('carries nothing about the product being analysed', () => {
    for (const slot of ['popup', 'options'] as const) {
      const serialised = JSON.stringify(buildAdRequest(slot));
      for (const [name, value] of Object.entries(FORBIDDEN)) {
        expect(serialised, `${slot} request leaked ${name}`).not.toContain(value);
      }
    }
  });

  it('carries no identifier that could link two requests', () => {
    // No uuid, no install id, no timestamp. Two requests from two installs
    // must be indistinguishable, or the slot becomes a fingerprint.
    const a = JSON.stringify(buildAdRequest('popup'));
    const b = JSON.stringify(buildAdRequest('popup'));
    expect(a).toBe(b);
  });

  it('produces a request that differs only by slot', () => {
    const popup = buildAdRequest('popup');
    const options = buildAdRequest('options');
    expect(popup.slot).toBe('popup');
    expect(options.slot).toBe('options');
    expect({ ...popup, slot: null }).toEqual({ ...options, slot: null });
  });

  it('never accepts a creative format that carries behaviour', () => {
    // 'html' or 'script' would let a network hand us code instead of fields.
    const formats = buildAdRequest('popup').formats as readonly string[];
    expect(formats).not.toContain('html');
    expect(formats).not.toContain('script');
    expect(formats.length).toBeGreaterThan(0);
  });

  it('control: the leak assertion can actually fail', () => {
    // Five checks in this project's history passed while proving nothing.
    // Prove this one fires before trusting the four above it.
    const poisoned = JSON.stringify({ ...buildAdRequest('popup'), asin: FORBIDDEN.asin });
    expect(poisoned).toContain(FORBIDDEN.asin);
  });
});
