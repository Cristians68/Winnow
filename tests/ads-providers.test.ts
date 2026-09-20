import { describe, expect, it } from 'vitest';
import { AD_NETWORKS } from '../src/shared/ads/registry.js';
import { BEHAVIOUR_FIELDS, MAX_BODY, MAX_HEADLINE, normaliseCreative } from '../src/shared/ads/providers.js';

const ORIGIN = AD_NETWORKS[0].origin;

/** A response with every field valid, used as the base for each hostile variant. */
function good(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    headline: 'Ship faster with Widgets',
    body: 'A tool for people who build things.',
    advertiser: 'Widget Co',
    clickUrl: `${ORIGIN}/click/abc`,
    imageUrl: `${ORIGIN}/img/abc.png`,
    viewUrl: `${ORIGIN}/view/abc`,
    ...overrides,
  };
}

describe('normaliseCreative', () => {
  it('accepts a well-formed creative', () => {
    const creative = normaliseCreative('ethical', good());
    expect(creative).not.toBe(null);
    expect(creative?.headline).toBe('Ship faster with Widgets');
    expect(creative?.advertiser).toBe('Widget Co');
    expect(creative?.provider).toBe('ethical');
  });

  /**
   * Every case below must return null, not a repaired creative.
   *
   * This codebase learned twice on the Amazon side that a partial parse is
   * worse than no parse: a half-read page produced a confident finding about
   * a seller. The same rule applies to a half-trusted ad — a creative with the
   * advertiser name dropped is an ad whose payer is hidden, which is worse
   * than showing nothing.
   */
  const hostile: Array<[string, Record<string, unknown>]> = [
    ['a javascript: click url', good({ clickUrl: 'javascript:alert(1)' })],
    ['a data: click url', good({ clickUrl: 'data:text/html,<script>alert(1)</script>' })],
    ['a click url on an unknown host', good({ clickUrl: 'https://tracker.example.com/c' })],
    ['a plaintext http click url', good({ clickUrl: `${ORIGIN.replace('https', 'http')}/c` })],
    ['an image on an unknown host', good({ imageUrl: 'https://tracker.example.com/p.gif' })],
    ['a view url on an unknown host', good({ viewUrl: 'https://tracker.example.com/v' })],
    ['a missing advertiser', good({ advertiser: '' })],
    ['a missing headline', good({ headline: '' })],
    ['a whitespace-only advertiser', good({ advertiser: '   ' })],
    ['a missing click url', good({ clickUrl: undefined })],
    ['an over-long headline', good({ headline: 'x'.repeat(MAX_HEADLINE + 1) })],
    ['an over-long body', good({ body: 'y'.repeat(MAX_BODY + 1) })],
    ['a non-string headline', good({ headline: { toString: () => 'sneaky' } })],
    ['a numeric advertiser', good({ advertiser: 12345 })],
    ['an array body', good({ body: ['a', 'b'] })],
    ['an html field smuggled in', { ...good(), html: '<script>alert(1)</script>' }],
    ['null', null],
    ['a string instead of an object', 'nope'],
    ['an empty object', {}],
  ];

  for (const [name, payload] of hostile) {
    it(`refuses ${name}`, () => {
      expect(normaliseCreative('ethical', payload)).toBe(null);
    });
  }

  it('refuses every field that offers behaviour rather than content', () => {
    expect(BEHAVIOUR_FIELDS.length).toBeGreaterThan(0); // control
    for (const field of BEHAVIOUR_FIELDS) {
      expect(
        normaliseCreative('ethical', { ...good(), [field]: 'anything' }),
        `${field} was allowed through`,
      ).toBe(null);
    }
  });

  it('still ignores an unknown but harmless field', () => {
    // Networks add optional fields over time. Rejecting every unknown key
    // would break every install the first time one shipped a new feature.
    const creative = normaliseCreative('ethical', { ...good(), campaignColour: 'blue' });
    expect(creative).not.toBe(null);
    expect(creative && 'campaignColour' in creative).toBe(false);
  });

  it('drops an optional image without discarding the creative', () => {
    // Absent is fine; present-but-hostile is not. Those are different cases.
    const creative = normaliseCreative('ethical', good({ imageUrl: undefined, viewUrl: undefined }));
    expect(creative).not.toBe(null);
    expect(creative?.imageUrl).toBe(null);
    expect(creative?.viewUrl).toBe(null);
  });

  it('never carries an html field through', () => {
    const creative = normaliseCreative('ethical', { ...good(), html: '<b>x</b>' });
    expect(creative === null || !('html' in creative)).toBe(true);
  });

  it('trims surrounding whitespace rather than rendering it', () => {
    const creative = normaliseCreative('ethical', good({ headline: '  Padded  ' }));
    expect(creative?.headline).toBe('Padded');
  });

  it('control: the hostile cases are actually being rejected by validation', () => {
    // Prove the helper can return non-null, so the 19 rejections above mean
    // "validation fired", not "normaliseCreative always returns null".
    expect(normaliseCreative('ethical', good())).not.toBe(null);
  });
});
