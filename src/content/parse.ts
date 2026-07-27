/**
 * Amazon product-page parser.
 *
 * This is the most fragile file in the project by a wide margin — Amazon
 * restructures its markup regularly and runs many layout experiments
 * concurrently, so any single selector will eventually break.
 *
 * Two rules govern everything here:
 *
 *  1. Every field uses a fallback chain and returns `undefined` rather than
 *     throwing. A snapshot missing its histogram is still useful; a parser that
 *     throws produces nothing at all.
 *  2. We read only what the page already rendered. No fetches, no navigation,
 *     no background requests against the user's session. See the design spec.
 */

import type { ProductSnapshot, Review, Star } from '../core/types.js';

/** Try selectors in order, return the first element that matches. */
function pick(root: ParentNode, selectors: string[]): Element | null {
  for (const selector of selectors) {
    try {
      const el = root.querySelector(selector);
      if (el) return el;
    } catch {
      // Malformed selector on an older Chrome — skip it.
    }
  }
  return null;
}

function pickAll(root: ParentNode, selectors: string[]): Element[] {
  for (const selector of selectors) {
    try {
      const els = [...root.querySelectorAll(selector)];
      if (els.length > 0) return els;
    } catch {
      /* skip */
    }
  }
  return [];
}

function textOf(el: Element | null): string {
  return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/** Parse a number that may carry thousands separators, e.g. "12,345". */
function parseCount(raw: string): number | undefined {
  const match = raw.replace(/[  ]/g, ' ').match(/([\d][\d.,\s]*)/);
  if (!match) return undefined;
  const cleaned = match[1]!.replace(/[.,\s](?=\d{3}\b)/g, '').replace(/[,\s]/g, '');
  const value = Number.parseInt(cleaned, 10);
  return Number.isFinite(value) ? value : undefined;
}

/** Pull the leading decimal from strings like "4.3 out of 5 stars". */
function parseDecimal(raw: string): number | undefined {
  const match = raw.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]!.replace(',', '.'));
  return Number.isFinite(value) ? value : undefined;
}

// --- ASIN ------------------------------------------------------------------

export function extractAsin(url: string = location.href, doc: Document = document): string | null {
  const urlPatterns = [
    /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/product-reviews\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /[?&]asin=([A-Z0-9]{10})\b/i,
  ];
  for (const pattern of urlPatterns) {
    const match = url.match(pattern);
    if (match) return match[1]!.toUpperCase();
  }

  const el = pick(doc, ['input#ASIN', 'input[name="ASIN"]', '#averageCustomerReviews[data-asin]', '[data-asin]']);
  const fromDom = el?.getAttribute('value') ?? el?.getAttribute('data-asin');
  if (fromDom && /^[A-Z0-9]{10}$/i.test(fromDom)) return fromDom.toUpperCase();

  return null;
}

export function isProductPage(url: string = location.href): boolean {
  return /\/(dp|gp\/product|product-reviews)\//i.test(url);
}

/**
 * Amazon's bot-check interstitial.
 *
 * These pages keep the product URL — `/dp/<ASIN>` and all — while serving none
 * of the product content. Without this check the ASIN still parses, the review
 * list comes back empty, and we would cheerfully mount a "couldn't read this
 * page" panel on top of a captcha wall. Better to say nothing at all.
 */
export function isInterstitial(doc: Document = document): boolean {
  if (doc.querySelector('form[action*="validateCaptcha"], form[action*="/errors/"]')) return true;

  const text = doc.body?.innerText ?? '';
  return /click the button below to continue shopping|enter the characters you see below|we just need to make sure you'?re not a robot|type the characters you see in this image/i.test(
    text,
  );
}

// --- Product-level fields --------------------------------------------------

function extractTitle(doc: Document): string | undefined {
  const el = pick(doc, ['#productTitle', '#title span', 'h1#title', 'h1 span#productTitle']);
  return textOf(el) || undefined;
}

function extractDisplayedRating(doc: Document): number | undefined {
  const el = pick(doc, [
    '[data-hook="rating-out-of-text"]',
    '#acrPopover .a-icon-alt',
    '#averageCustomerReviews .a-icon-alt',
    'span[data-hook="average-star-rating"] .a-icon-alt',
    '#acrPopover',
  ]);
  if (!el) return undefined;
  // #acrPopover carries the value in its title when the inner text is hidden.
  const raw = textOf(el) || el.getAttribute('title') || '';
  const value = parseDecimal(raw);
  return value !== undefined && value >= 1 && value <= 5 ? value : undefined;
}

function extractTotalRatings(doc: Document): number | undefined {
  const el = pick(doc, [
    '#acrCustomerReviewText',
    '[data-hook="total-review-count"]',
    '#reviewsMedley [data-hook="total-review-count"]',
  ]);
  return el ? parseCount(textOf(el)) : undefined;
}

/**
 * The rating histogram.
 *
 * Amazon has shipped several markups for this. The most durable signal across
 * all of them is the accessible label, which reads like
 * "5 stars represent 78% of rating" — so we try that first and fall back to
 * table scraping.
 */
/**
 * Pair star labels with percentages positionally.
 *
 * Amazon's 2026 histogram is laid out in columns, not rows: one column holds
 * "5 star", "4 star", … and another holds "83%", "8%", …. Parsing row by row
 * grabs the first star and the first percentage it meets, yielding `{5: 83}`,
 * which normalises to a confident and completely wrong "100% 5-star".
 *
 * Reading the two sequences separately and zipping them by index handles both
 * the column and row layouts, since either way labels and percentages appear in
 * the same order.
 */
function pairHistogramColumns(container: ParentNode): Partial<Record<Star, number>> | null {
  const leaves = [...container.querySelectorAll('*')].filter((el) => el.children.length === 0);

  const stars: Star[] = [];
  const percentages: number[] = [];

  for (const leaf of leaves) {
    const text = textOf(leaf);
    const star = text.match(/^([1-5])\s*stars?$/i);
    if (star) {
      stars.push(Number(star[1]) as Star);
      continue;
    }
    const percentage = text.match(/^(\d{1,3})\s*%$/);
    if (percentage) percentages.push(Number(percentage[1]));
  }

  if (stars.length < 4 || stars.length !== percentages.length) return null;

  const histogram: Partial<Record<Star, number>> = {};
  stars.forEach((star, index) => {
    histogram[star] = percentages[index]!;
  });
  return histogram;
}

/**
 * A half-read histogram is worse than none.
 *
 * A single captured bucket normalises to "100% 5-star with no negative tail" —
 * the exact signature of manipulation — so a parsing failure would masquerade
 * as strong evidence of fraud. Require near-complete, near-summing data before
 * trusting it, and return nothing otherwise.
 */
export function isPlausibleHistogram(histogram: Partial<Record<Star, number>>): boolean {
  const values = ([1, 2, 3, 4, 5] as Star[]).map((s) => histogram[s]).filter((v): v is number => v !== undefined);
  if (values.length < 4) return false;
  const total = values.reduce((sum, v) => sum + v, 0);
  return total >= 80 && total <= 120;
}

export function extractHistogram(doc: Document): Partial<Record<Star, number>> | undefined {
  const histogram: Partial<Record<Star, number>> = {};

  // Strategy 0: positional pairing inside the histogram container.
  for (const selector of ['#histogramTable', '#cm_cr_dp_d_rating_histogram', '[class*="ratings-histogram"]']) {
    const container = doc.querySelector(selector);
    if (!container) continue;
    const paired = pairHistogramColumns(container);
    if (paired && isPlausibleHistogram(paired)) return paired;
  }

  // Strategy 1: aria-labels / link titles anywhere in the reviews module.
  const labelled = pickAll(doc, [
    '#histogramTable a[aria-label]',
    '[data-hook="cr-histogram-row"] a[aria-label]',
    '#cm_cr_dp_d_rating_histogram a[aria-label]',
    'a[aria-label*="stars represent"]',
    'a[title*="stars represent"]',
  ]);
  for (const el of labelled) {
    const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '';
    const starMatch = label.match(/([1-5])\s*star/i);
    const pctMatch = label.match(/(\d{1,3})\s*%/);
    if (starMatch && pctMatch) {
      histogram[Number(starMatch[1]) as Star] = Number(pctMatch[1]);
    }
  }
  if (isPlausibleHistogram(histogram)) return histogram;

  // Strategy 2: walk the histogram rows.
  //
  // Amazon's 2026 rebuild turned #histogramTable from a <table> into a <ul>, so
  // `tr` can never match it. Both shapes are listed, plus a class-based catch
  // for the CSS-module markup, because the id has changed before too.
  const rows = pickAll(doc, [
    '#histogramTable li',
    '#histogramTable tr',
    '[data-hook="cr-histogram-row"]',
    '#cm_cr_dp_d_rating_histogram li',
    '#cm_cr_dp_d_rating_histogram tr',
    '[class*="histogram"] li',
  ]);
  rows.forEach((row) => {
    const rowText = textOf(row);
    const starMatch = rowText.match(/([1-5])\s*star/i);
    const pctMatch = rowText.match(/(\d{1,3})\s*%/);
    if (starMatch && pctMatch) {
      histogram[Number(starMatch[1]) as Star] = Number(pctMatch[1]);
    }
  });

  // Anything less than a plausible, near-complete histogram is discarded: the
  // "no data" state is honest, a partial one actively lies.
  return isPlausibleHistogram(histogram) ? histogram : undefined;
}

// --- Reviews ---------------------------------------------------------------

function parseReviewDate(raw: string): string | undefined {
  // "Reviewed in the United States on June 3, 2026" / "on 3 June 2026"
  const match = raw.match(/on\s+(.+)$/i);
  const candidate = (match?.[1] ?? raw).trim();
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString().slice(0, 10);
}

function parseRating(el: Element | null): Star | undefined {
  if (!el) return undefined;
  const raw = textOf(el) || el.getAttribute('title') || el.getAttribute('aria-label') || '';
  const value = parseDecimal(raw);
  if (value === undefined) return undefined;
  const rounded = Math.round(value);
  return rounded >= 1 && rounded <= 5 ? (rounded as Star) : undefined;
}

function parseHelpfulVotes(raw: string): number {
  if (!raw) return 0;
  // "One person found this helpful" has no digit.
  if (/\bone\b/i.test(raw) && /helpful/i.test(raw)) return 1;
  return parseCount(raw) ?? 0;
}

/**
 * Review body text.
 *
 * Amazon's 2026 rebuild moved the body out of `[data-hook="review-body"]` and
 * into CSS-module markup (`_Y3Itd_contain-rich-content_*`) holding real `<p>`
 * elements. Named hooks are tried first, then a class-substring match, then —
 * crucially — a structural fallback that collects the paragraphs directly.
 *
 * The structural fallback is the durable one: Amazon renames hooks and hashes
 * class names between builds, but review prose has to live in text nodes
 * somewhere, and it has been in `<p>` tags across every layout so far.
 */
export function extractBody(node: Element): string {
  const named = pick(node, [
    '[data-hook="review-body"] span:not([class])',
    '[data-hook="review-body"] span',
    '[data-hook="reviewText"]',
    '[data-hook="reviewBody"]',
    '[data-hook="review-collapsed"]',
    '[data-hook="review-body"]',
    '.review-text-content span',
    '[class*="contain-rich-content"]',
    '[class*="review-text"]',
  ]);
  if (named) {
    const text = textOf(named);
    if (text.length > 0) return stripExpanderChrome(text);
  }

  // Structural fallback: the paragraphs of the review itself.
  const paragraphs = [...node.querySelectorAll('p')]
    .map((p) => textOf(p))
    .filter((text) => text.length > 0);

  if (paragraphs.length > 0) return stripExpanderChrome(paragraphs.join(' '));

  return '';
}

/** Amazon appends its own expander affordances to the text; drop them. */
function stripExpanderChrome(text: string): string {
  return text
    .replace(/\s*Read more\s*Read less\s*$/i, '')
    .replace(/\s*Read more\s*$/i, '')
    .replace(/\s*,?\s*double tap to read (full|brief) content\.?/gi, '')
    .replace(/\s*(Full|Brief) content visible\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractReviews(doc: Document = document): Review[] {
  const nodes = pickAll(doc, [
    'div[data-hook="review"]',
    'li[data-hook="review"]',
    '#cm-cr-dp-review-list div[data-hook="review"]',
    '[id^="customer_review-"]',
  ]);

  const reviews: Review[] = [];

  nodes.forEach((node, index) => {
    try {
      const rating = parseRating(
        pick(node, [
          '[data-hook="review-star-rating"] .a-icon-alt',
          '[data-hook="cmps-review-star-rating"] .a-icon-alt',
          '[data-hook="review-star-rating"]',
          '.review-rating .a-icon-alt',
          'i[class*="a-star-"]',
        ]),
      );
      if (rating === undefined) return; // Without a rating the row is unusable.

      const body = extractBody(node);

      // The title is an <h5> in the 2026 markup; the old hook may or may not
      // still be attached to it, so the element type is the reliable anchor.
      const titleEl = pick(node, [
        '[data-hook="review-title"] span:not([class])',
        '[data-hook="review-title"] span:last-of-type',
        '[data-hook="review-title"]',
        '[data-hook="reviewTitle"]',
        '[class*="single-review-title"]',
        'h5 a',
        'h5',
        '.review-title',
      ]);
      // The title element often contains the star rating as hidden text; drop
      // any leading "5.0 out of 5 stars" fragment.
      const title = textOf(titleEl).replace(/^\s*\d(?:\.\d)?\s*out of\s*5\s*stars?\s*/i, '').trim();

      const dateRaw = textOf(pick(node, ['[data-hook="review-date"]', '.review-date']));
      const verified = Boolean(pick(node, ['[data-hook="avp-badge"]', '.a-color-state.a-text-bold']));
      const helpfulVotes = parseHelpfulVotes(
        textOf(pick(node, ['[data-hook="helpful-vote-statement"]', '.cr-vote-text'])),
      );

      const profileLink = pick(node, ['a.a-profile', '[data-hook="genome-widget"] a']);
      const reviewerId =
        profileLink?.getAttribute('href')?.match(/\/profile\/([^/?#]+)/)?.[1] ?? undefined;
      const reviewerName = textOf(pick(node, ['.a-profile-name'])) || undefined;

      reviews.push({
        id: node.id || `winnow-review-${index}`,
        rating,
        date: dateRaw ? parseReviewDate(dateRaw) : undefined,
        verified,
        text: body,
        title: title || undefined,
        helpfulVotes,
        reviewerId,
        reviewerName,
      });
    } catch {
      // One malformed review must never cost us the rest of the page.
    }
  });

  return reviews;
}

// --- Snapshot --------------------------------------------------------------

export function buildSnapshot(doc: Document = document, url: string = location.href): ProductSnapshot | null {
  if (isInterstitial(doc)) return null;

  const asin = extractAsin(url, doc);
  if (!asin) return null;

  return {
    asin,
    title: extractTitle(doc),
    displayedRating: extractDisplayedRating(doc),
    totalRatings: extractTotalRatings(doc),
    histogram: extractHistogram(doc),
    reviews: extractReviews(doc),
    capturedAt: new Date().toISOString(),
  };
}
