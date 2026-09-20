import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_ORIGIN, clearTestNetwork, useTestNetwork } from './helpers/ad-fixture.js';
import {
  BEHAVIOUR_FIELDS,
  MAX_BODY,
  MAX_HEADLINE,
  normaliseCreative,
  selectCreative,
} from '../src/shared/ads/providers.js';

const ORIGIN = TEST_ORIGIN;

beforeAll(() => useTestNetwork());
afterAll(() => clearTestNetwork());

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
  const hostile: Array<[string, unknown]> = [
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


  it('treats a null body as absent, like the other optional fields', () => {
    // imageUrl and viewUrl accept null as "not supplied", so a sponsor file
    // author writing "body": null is following the pattern of the file — and
    // the example in site/sponsors.json uses null for exactly that reason.
    // Rejecting the whole creative over it loses the ad silently: an empty
    // slot is indistinguishable from "no sponsor available", in the one code
    // path revenue actually comes from.
    const creative = normaliseCreative('direct', good({ body: null }));
    expect(creative).not.toBe(null);
    expect(creative?.body).toBe('');
  });

  it('still rejects a body that is present but not text', () => {
    // null means absent; a number or an object means the network sent us
    // something we do not understand, and that is still a rejection.
    for (const body of [123, { toString: () => 'x' }, ['a'], true]) {
      expect(normaliseCreative('direct', good({ body })), `body=${JSON.stringify(body)}`).toBe(null);
    }
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

/**
 * A self-hosted sponsor file holds more than one sponsor.
 *
 * The direct rail is the one that can earn without anybody's approval, and a
 * file that can hold exactly one sponsor is a file you have to redeploy to
 * rotate. Selecting here rather than server-side keeps the host a static
 * document — no server, no logs, nothing to run.
 */
describe('selectCreative', () => {
  it('accepts a single creative object', () => {
    const creative = selectCreative('direct', good(), () => 0);
    expect(creative?.advertiser).toBe('Widget Co');
  });

  it('accepts a list and picks one', () => {
    const list = [good({ advertiser: 'First Co' }), good({ advertiser: 'Second Co' })];
    expect(selectCreative('direct', list, () => 0)?.advertiser).toBe('First Co');
    // 0.99 must land on the last entry, not past it.
    expect(selectCreative('direct', list, () => 0.99)?.advertiser).toBe('Second Co');
  });

  it('never indexes past the end of the list', () => {
    // Math.random() is documented as < 1, but a caller could pass anything and
    // an out-of-range index would silently return undefined, which normalises
    // to null and looks exactly like "no sponsor available".
    const list = [good({ advertiser: 'Only Co' })];
    for (const r of [0, 0.5, 0.999999, 1, 1.5, -1]) {
      expect(selectCreative('direct', list, () => r)?.advertiser, `r=${r}`).toBe('Only Co');
    }
  });

  it('skips an invalid entry rather than showing nothing', () => {
    // One malformed sponsor must not take the whole file down with it — but a
    // malformed one is still never rendered.
    const list = [{ headline: 'broken' }, good({ advertiser: 'Valid Co' })];
    expect(selectCreative('direct', list, () => 0)?.advertiser).toBe('Valid Co');
  });

  it('returns null when every entry is invalid', () => {
    expect(selectCreative('direct', [{ headline: 'broken' }, null], () => 0)).toBe(null);
  });

  it('returns null for an empty list', () => {
    expect(selectCreative('direct', [], () => 0)).toBe(null);
  });

  it('control: selection can return different sponsors', () => {
    // Otherwise "picks one" would pass for an implementation that always
    // returns the first entry, and rotation would silently not rotate.
    const list = [good({ advertiser: 'A Co' }), good({ advertiser: 'B Co' })];
    const first = selectCreative('direct', list, () => 0)?.advertiser;
    const second = selectCreative('direct', list, () => 0.75)?.advertiser;
    expect(first).not.toBe(second);
  });
});
