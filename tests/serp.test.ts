// @vitest-environment happy-dom
/**
 * Reading an Amazon search results grid.
 *
 * The whole search-page feature rests on two questions this module answers:
 * is this page a search grid, and which card is which product. Both have a
 * wrong answer that is worse than no answer — a badge on the wrong listing —
 * so the tests below are as much about what it declines to read as what it does.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isSearchPage, findSearchCards } from '../src/content/serp-parse.js';

function searchDoc(): Document {
  const html = readFileSync('tests/fixtures/search-synthetic.html', 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('search page detection', () => {
  it('recognises search and category listing URLs', () => {
    expect(isSearchPage('https://www.amazon.com/s?k=usb+cable')).toBe(true);
    expect(isSearchPage('https://www.amazon.co.uk/s?i=electronics&rh=n%3A123')).toBe(true);
  });

  it('does not claim product pages, carts or account pages', () => {
    for (const url of [
      'https://www.amazon.com/dp/B0REAL0001',
      'https://www.amazon.com/gp/cart/view.html',
      'https://www.amazon.com/gp/css/order-history',
      'https://www.amazon.com/',
    ]) {
      expect(isSearchPage(url)).toBe(false);
    }
  });
});

describe('reading search cards', () => {
  it('finds the product cards and their ASINs', () => {
    const cards = findSearchCards(searchDoc());
    expect(cards.map((c) => c.asin)).toEqual(['B0REAL0001', 'B0REAL0002']);
  });

  // A card whose ASIN cannot be read gets no badge at all. A badge attached to
  // the wrong product is worse than no badge, and this is the same rule the
  // product parser follows: degrade to nothing rather than to a guess.
  //
  // Each of these asserts a non-empty result first. Every "skips X" assertion
  // below is trivially true of an empty array, so without that line a reader
  // that found nothing at all would pass all three of them.
  it('skips cards with no readable ASIN', () => {
    const asins = findSearchCards(searchDoc()).map((c) => c.asin);
    expect(asins.length).toBeGreaterThan(0);
    expect(asins).not.toContain('');
  });

  it('skips cards whose ASIN is not the right shape', () => {
    const asins = findSearchCards(searchDoc()).map((c) => c.asin);
    expect(asins.length).toBeGreaterThan(0);
    expect(asins).not.toContain('B0MALFORMED1');
  });

  it('skips sponsored cards', () => {
    const asins = findSearchCards(searchDoc()).map((c) => c.asin);
    expect(asins.length).toBeGreaterThan(0);
    expect(asins).not.toContain('B0SPONSOR1');
  });

  it('returns an anchor element inside each card to hang a badge on', () => {
    const cards = findSearchCards(searchDoc());
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.anchor).toBeTruthy();
      expect(card.element.contains(card.anchor)).toBe(true);
    }
  });

  it('returns nothing on a page with no search grid', () => {
    const doc = new DOMParser().parseFromString('<html><body><p>hi</p></body></html>', 'text/html');
    expect(findSearchCards(doc)).toEqual([]);
  });
});
