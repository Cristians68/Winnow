/**
 * Drawing a sponsorship slot.
 *
 * Every string here arrives from a third party and is written with
 * `textContent`. There is no innerHTML, no insertAdjacentHTML, no template
 * string containing a creative field, and no sanitiser — a sanitiser is a
 * thing you have to trust, whereas textContent is a thing that cannot parse
 * markup in the first place.
 *
 * The label is not optional and not a caller's decision. Winnow's product
 * claim is that its verdict is not for sale; an unlabelled ad rendered in a
 * verdict surface reads as an endorsement, which would make the claim false
 * in the only place it matters. So the label and the advertiser's name are
 * built in the same function as the creative, and the creative cannot be
 * rendered without them.
 */

import { isAllowedCreativeUrl } from './registry.js';
import type { AdCreative } from './types.js';

/** Shown above every creative, always. */
export const AD_LABEL = 'Sponsored';

/** Explains, in the slot itself, what the ad cannot see. */
export const AD_DISCLOSURE = 'Chosen without knowing which product you are viewing.';

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  // textContent, not innerHTML. This is the whole defence.
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Render a creative into `host`, replacing whatever was there.
 *
 * A null creative empties the slot. Rendering is all-or-nothing: if the click
 * destination is not one we would allow, nothing renders at all, because an ad
 * body with no working link is still an advertiser's message displayed for
 * free inside a tool that says it takes no money to say things.
 */
export function renderAd(host: HTMLElement, creative: AdCreative | null): void {
  host.replaceChildren();
  if (!creative) return;

  // Re-checked here even though normaliseCreative already rejected bad URLs.
  // The renderer must not be the one component that trusts its input: a future
  // caller could hand it a creative that never went through normalisation, and
  // that caller would not know this file's rules.
  if (!isAllowedCreativeUrl(creative.clickUrl)) return;

  const slot = el('div', 'ad-slot');

  const header = el('div', 'ad-head');
  header.append(el('span', 'ad-label', AD_LABEL));
  header.append(el('span', 'ad-by', creative.advertiser));
  slot.append(header);

  const link = document.createElement('a');
  link.className = 'ad-body';
  link.href = creative.clickUrl;
  link.target = '_blank';
  // noopener denies the destination a handle on this page; noreferrer stops it
  // learning which of Winnow's surfaces the click came from.
  link.rel = 'noopener noreferrer';

  if (creative.imageUrl && isAllowedCreativeUrl(creative.imageUrl)) {
    const img = document.createElement('img');
    img.className = 'ad-img';
    img.src = creative.imageUrl;
    // The advertiser's name, not the creative's filename, is what a screen
    // reader should announce. Never empty alt: this is meaningful content.
    img.alt = `${creative.advertiser} advertisement`;
    img.loading = 'lazy';
    img.decoding = 'async';
    link.append(img);
  }

  const copy = el('div', 'ad-copy');
  copy.append(el('span', 'ad-headline', creative.headline));
  if (creative.body) copy.append(el('span', 'ad-text', creative.body));
  link.append(copy);

  slot.append(link);
  slot.append(el('p', 'ad-note', AD_DISCLOSURE));

  host.append(slot);
}

/**
 * Ask the worker for a creative and render it.
 *
 * Never throws and never reports failure to the caller. A slot that cannot be
 * filled stays empty; the grade above it is the product and must not be
 * affected by an ad server having a bad day.
 */
export async function mountAdSlot(host: HTMLElement, slot: 'popup' | 'options'): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'winnow:ad-request',
      slot,
    })) as { ok: boolean; creative: AdCreative | null } | undefined;

    const creative = response?.creative ?? null;
    renderAd(host, creative);

    // Count the impression only after it actually rendered, so a creative the
    // renderer refused is never billed as seen.
    if (creative?.viewUrl && host.querySelector('.ad-slot')) {
      void chrome.runtime.sendMessage({ type: 'winnow:ad-view', viewUrl: creative.viewUrl });
    }
  } catch {
    renderAd(host, null);
  }
}
