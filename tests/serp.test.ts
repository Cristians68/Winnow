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
import { renderBadges, BADGE_CLASS } from '../src/content/serp-ui.js';
import type { CachedGrade } from '../src/shared/cache.js';

function searchDoc(): Document {
  const html = readFileSync('tests/fixtures/search-synthetic.html', 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}

function badges(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll(`.${BADGE_CLASS}`)] as HTMLElement[];
}

function cacheWith(asin: string, grade: CachedGrade['grade'], score: number): Map<string, CachedGrade> {
  return new Map([[asin, {
    asin, grade, score, engineVersion: '0.3.0', date: '2026-08-01', seen: Date.now(),
  }]]);
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

describe('search badges', () => {
  // The liveness pair. A badge layer that silently shows nothing is
  // indistinguishable from one that found nothing, and that difference is the
  // whole feature. One product that MUST show its grade, one that MUST NOT.
  it('shows a grade for a product already graded', () => {
    const doc = searchDoc();
    const cards = findSearchCards(doc);
    renderBadges(cards, cacheWith('B0REAL0001', 'D', 42));

    const graded = badges(doc).find((b) => b.dataset.winnowAsin === 'B0REAL0001');
    expect(graded?.dataset.winnowState).toBe('graded');
    expect(graded?.textContent).toContain('D');
  });

  it('shows "not checked" for a product it has never graded', () => {
    const doc = searchDoc();
    renderBadges(findSearchCards(doc), new Map());
    const unchecked = badges(doc).find((b) => b.dataset.winnowAsin === 'B0REAL0002');
    expect(unchecked?.dataset.winnowState).toBe('unchecked');
    expect(unchecked?.textContent?.toLowerCase()).toContain('not checked');
  });

  // Guessing from a star average is the thing this whole design refuses to do.
  it('never renders a grade for an uncached product', () => {
    const doc = searchDoc();
    renderBadges(findSearchCards(doc), new Map());
    expect(badges(doc).length).toBeGreaterThan(0);
    for (const badge of badges(doc)) {
      expect(badge.textContent).not.toMatch(/\b[ABCF]\b/);
    }
  });

  it('is idempotent — re-rendering does not duplicate badges', () => {
    const doc = searchDoc();
    renderBadges(findSearchCards(doc), new Map());
    renderBadges(findSearchCards(doc), new Map());
    expect(badges(doc)).toHaveLength(2);
  });

  // A grade that has fallen out of the cache — cleared from Options, expired,
  // or invalidated by an engine bump — must stop looking like a grade. The
  // element is reused across re-renders, so the colour it was given as a D
  // would otherwise stay painted under the words "not checked".
  it('drops the grade colour when a product falls out of the cache', () => {
    const doc = searchDoc();
    renderBadges(findSearchCards(doc), cacheWith('B0REAL0001', 'F', 12));
    renderBadges(findSearchCards(doc), new Map());

    const badge = badges(doc).find((b) => b.dataset.winnowAsin === 'B0REAL0001')!;
    expect(badge.dataset.winnowState).toBe('unchecked');
    expect(badge.style.background).toBe('');
    expect(badge.style.color).toBe('');
  });

  it('gives every badge an accessible label naming the product state', () => {
    const doc = searchDoc();
    renderBadges(findSearchCards(doc), new Map());
    expect(badges(doc).length).toBeGreaterThan(0);
    for (const badge of badges(doc)) {
      expect(badge.getAttribute('role')).toBe('note');
      expect(badge.getAttribute('aria-label')).toBeTruthy();
    }
  });

  // Winnow measures review integrity and never reads whether reviews say the
  // product is good. Same assertion the panel verdict is held to.
  it('never makes a claim about product quality', () => {
    const doc = searchDoc();
    renderBadges(findSearchCards(doc), cacheWith('B0REAL0001', 'F', 12));
    expect(badges(doc).length).toBeGreaterThan(0);
    for (const badge of badges(doc)) {
      expect(badge.textContent).not.toMatch(/bad|good|poor|quality|avoid|don't buy|scam|fake product/i);
    }
  });
});
