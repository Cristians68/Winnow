/**
 * Rendering a third party's copy inside a privileged extension page.
 *
 * Two properties matter here and both are asserted rather than reasoned about:
 * nothing from the network is ever parsed as HTML, and a creative never renders
 * without the word Sponsored and the advertiser's name beside it. The second is
 * not decoration — Winnow's whole claim is that its verdict is not for sale, and
 * an unlabelled ad inside a verdict surface reads as an endorsement.
 */

// @vitest-environment happy-dom

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AD_LABEL, renderAd } from '../src/shared/ads/render.js';
import { TEST_ORIGIN, clearTestNetwork, useTestNetwork } from './helpers/ad-fixture.js';
import type { AdCreative } from '../src/shared/ads/types.js';

const ORIGIN = TEST_ORIGIN;

beforeAll(() => useTestNetwork());
afterAll(() => clearTestNetwork());

function creative(overrides: Partial<AdCreative> = {}): AdCreative {
  return {
    provider: 'ethical',
    headline: 'Ship faster with Widgets',
    body: 'A tool for people who build things.',
    advertiser: 'Widget Co',
    clickUrl: `${ORIGIN}/click/abc`,
    imageUrl: null,
    viewUrl: null,
    ...overrides,
  };
}

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.append(host);
});

describe('renderAd', () => {
  it('renders the headline, body and advertiser', () => {
    renderAd(host, creative());
    expect(host.textContent).toContain('Ship faster with Widgets');
    expect(host.textContent).toContain('A tool for people who build things.');
    expect(host.textContent).toContain('Widget Co');
  });

  it('never parses a creative field as HTML', () => {
    // The classic payload. If this renders as an element, an ad network can
    // run code in a page that holds extension privileges.
    const payload = '<img src=x onerror=alert(1)>';
    renderAd(host, creative({ headline: payload }));

    expect(host.querySelectorAll('img').length).toBe(0);
    expect(host.querySelector('script')).toBe(null);
    // The literal text is present, proving it went through textContent rather
    // than being stripped by a sanitiser we would then have to trust.
    expect(host.textContent).toContain(payload);
  });

  it('never parses a body or advertiser as HTML either', () => {
    // Testing only the headline would leave two fields unproven.
    renderAd(host, creative({ body: '<b>bold</b>', advertiser: '<i>Evil</i>' }));
    expect(host.querySelector('b')).toBe(null);
    expect(host.querySelector('i')).toBe(null);
    expect(host.textContent).toContain('<b>bold</b>');
  });

  it('always labels the slot as sponsored', () => {
    renderAd(host, creative());
    expect(host.textContent).toContain(AD_LABEL);
  });

  it('labels the slot even when the creative is minimal', () => {
    // An ad with no body must not lose its label along with its copy.
    renderAd(host, creative({ body: '', imageUrl: null }));
    expect(host.textContent).toContain(AD_LABEL);
    expect(host.textContent).toContain('Widget Co');
  });

  it('names the advertiser, not just the word sponsored', () => {
    // "Sponsored" alone does not tell a reader who paid.
    renderAd(host, creative({ advertiser: 'Specific Brand Ltd' }));
    expect(host.textContent).toContain('Specific Brand Ltd');
  });

  it('leaves the host empty for a null creative', () => {
    host.textContent = 'stale';
    renderAd(host, null);
    expect(host.children.length).toBe(0);
    expect(host.textContent).toBe('');
  });

  it('replaces a previous creative rather than appending', () => {
    renderAd(host, creative({ headline: 'First' }));
    renderAd(host, creative({ headline: 'Second' }));
    expect(host.textContent).not.toContain('First');
    expect(host.textContent).toContain('Second');
  });

  it('opens the click target in a new tab without leaking the opener', () => {
    renderAd(host, creative());
    const link = host.querySelector('a')!;
    expect(link.getAttribute('href')).toBe(`${ORIGIN}/click/abc`);
    expect(link.getAttribute('target')).toBe('_blank');
    // noopener stops the destination scripting this page; noreferrer stops it
    // learning which surface the click came from.
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('renders an image only when one was supplied', () => {
    renderAd(host, creative({ imageUrl: null }));
    expect(host.querySelector('img')).toBe(null);

    renderAd(host, creative({ imageUrl: `${ORIGIN}/img/a.png` }));
    expect(host.querySelector('img')?.getAttribute('src')).toBe(`${ORIGIN}/img/a.png`);
  });

  it('gives the image an alt attribute so it is not announced as a filename', () => {
    renderAd(host, creative({ imageUrl: `${ORIGIN}/img/a.png` }));
    const img = host.querySelector('img')!;
    expect(img.hasAttribute('alt')).toBe(true);
  });

  it('refuses an image url that is not on a registry origin', () => {
    // Defence in depth: normaliseCreative already rejects this, but the
    // renderer must not become the one place that trusts its input, because
    // a future caller might hand it something that skipped normalisation.
    renderAd(host, creative({ imageUrl: 'https://tracker.example.com/p.gif' }));
    expect(host.querySelector('img')).toBe(null);
  });

  it('refuses a click url that is not on a registry origin', () => {
    renderAd(host, creative({ clickUrl: 'javascript:alert(1)' }));
    expect(host.querySelector('a')).toBe(null);
    // With no safe destination there is nothing to render at all.
    expect(host.children.length).toBe(0);
  });

  it('control: the HTML-injection assertion can fail', () => {
    // Prove querySelector('img') finds an img when one genuinely exists, so
    // the two injection tests above mean "no element was created" rather than
    // "this query never matches anything".
    host.append(document.createElement('img'));
    expect(host.querySelectorAll('img').length).toBe(1);
  });
});
