/**
 * Reading product cards off an Amazon search results page.
 *
 * This module deliberately reads only two things: which ASIN a card is for, and
 * where inside it a badge can hang. It does not read the star average or the
 * rating count, because nothing downstream is allowed to grade from them — see
 * the header of src/shared/cache.ts for why.
 *
 * Sponsored cards are skipped. Not as a judgement about advertising, but
 * because their ASIN attribute is frequently a placeholder that resolves to a
 * different listing, and a badge on the wrong product is worse than no badge.
 */

export interface SearchCard {
  asin: string;
  element: HTMLElement;
  /** Where the badge is inserted. Always inside `element`. */
  anchor: HTMLElement;
}

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

/**
 * Search and category listing pages, and nothing else.
 *
 * Explicitly not the cart, order history, or account pages. The content script
 * is granted the whole storefront by the manifest, so this function is what
 * actually keeps Winnow off pages that are none of its business.
 */
export function isSearchPage(url: string = location.href): boolean {
  try {
    const { pathname } = new URL(url);
    return pathname === '/s' || pathname.startsWith('/s/') || pathname.startsWith('/b/');
  } catch {
    return false;
  }
}

export function findSearchCards(doc: Document = document): SearchCard[] {
  const cards: SearchCard[] = [];
  const slots = doc.querySelectorAll<HTMLElement>('[data-component-type="s-search-result"][data-asin]');

  for (const element of slots) {
    const asin = (element.getAttribute('data-asin') ?? '').trim().toUpperCase();
    if (!ASIN_PATTERN.test(asin)) continue;
    if (element.querySelector('.s-sponsored-label-text, [data-component-type="sp-sponsored-result"]')) continue;

    // Prefer the title heading: it is present on every card layout Amazon
    // currently ships, and a badge beside the title reads as being about the
    // product rather than about the price.
    const anchor = element.querySelector<HTMLElement>('h2') ?? element;
    cards.push({ asin, element, anchor });
  }
  return cards;
}
