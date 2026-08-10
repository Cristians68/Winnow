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

import type { ProductSnapshot, Review, SampleSource, Star } from '../core/types.js';
import { findStarCount, normaliseDigits, parseLocalisedDate, parseStarLabel } from '../core/language.js';
import { marketplaceFor } from '../core/marketplaces.js';

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

/**
 * Parse a number that may carry thousands separators, e.g. "12,345".
 *
 * Digits are normalised first. `\d` matches neither Arabic-Indic numerals nor
 * the Extended set, so on an Arabic storefront "٢٣٤ تقييم" returned undefined —
 * a listing with 234 ratings read as having none. That is not a harmless gap:
 * `MIN_RATINGS_FOR_HISTOGRAM_ONLY` and the helpfulness floor both branch on this
 * number, so our own inability to read it would surface as a finding about the
 * listing.
 */
function parseCount(raw: string): number | undefined {
  const match = normaliseDigits(raw).replace(/[  ]/g, ' ').match(/([\d][\d.,\s]*)/);
  if (!match) return undefined;
  const cleaned = match[1]!.replace(/[.,\s](?=\d{3}\b)/g, '').replace(/[,\s]/g, '');
  const value = Number.parseInt(cleaned, 10);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Pull the leading decimal from strings like "4.3 out of 5 stars".
 *
 * Digits normalised for the same reason as `parseCount`. The Arabic decimal
 * separator U+066B is folded to a period so "٤٫٣" reads as 4.3 rather than 43.
 */
function parseDecimal(raw: string): number | undefined {
  const match = normaliseDigits(raw).replace(/٫/g, '.').match(/(\d+(?:[.,]\d+)?)/);
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
 * Which kind of review sample this page is showing.
 *
 * A `/product-reviews/` page lists reviews in a stated order; a product page
 * shows the handful Amazon chose to feature. The scoring engine caps how far it
 * will trust the second kind, so getting this wrong in the optimistic direction
 * would let a biased sample carry full confidence. Anything we don't recognise
 * is therefore treated as featured.
 */
export function detectSampleSource(url: string = location.href): SampleSource {
  return /\/product-reviews\//i.test(url) ? 'listing' : 'featured';
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

  // The form check above is language-neutral and does most of the work. These
  // phrases are the backstop for layouts that render the challenge without a
  // recognisable form action, and they are listed per storefront because the
  // English-only version mounted a "couldn't read this page" panel on top of
  // every non-English captcha wall.
  const text = doc.body?.innerText ?? '';
  return /click the button below to continue shopping|enter the characters you see below|we just need to make sure you'?re not a robot|type the characters you see in this image|geben sie die zeichen ein|saisissez les caract|introduzca los caracteres|inserisci i caratteri|voer de tekens in|ange tecknen|wpisz znaki|以下に表示されている文字を入力/i.test(
    text,
  );
}

/**
 * The storefront's language, from the document.
 *
 * `<html lang>` is present on every Amazon storefront and is the page's own
 * statement about itself, so it beats guessing from the domain — amazon.ca
 * serves both English and French, and any user can switch language on any
 * storefront. The domain is only a fallback for the case where the attribute is
 * missing, and an unrecognised domain yields undefined rather than "en",
 * because a wrong language is worse here than an unknown one: it lets the
 * wording check run against a dictionary that cannot match.
 */
export function detectLanguage(doc: Document = document, url: string = location.href): string | undefined {
  const declared = doc.documentElement?.getAttribute('lang')?.trim();
  if (declared) return declared;

  try {
    // Falls back to the storefront's primary language, read from the registry.
    // This used to be a hand-written table of domain regexes that had silently
    // drifted from the manifest: amazon.com.mx, a Spanish storefront, was
    // absent from it entirely, so a Mexican page missing its lang attribute
    // reported no language and the wording check went quiet without saying so.
    // The registry cannot develop that gap — a storefront that names no
    // language it has tables for does not compile.
    return marketplaceFor(new URL(url).hostname)?.languages[0];
  } catch {
    return undefined;
  }
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
    // Star nouns differ per storefront ("5 Sterne", "5 étoiles", "星5つ"), and
    // requiring the English word left the histogram unreadable on eleven of the
    // fourteen domains the manifest matches.
    const star = parseStarLabel(text);
    if (star !== null) {
      stars.push(star as Star);
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
    const star = findStarCount(label);
    const pctMatch = label.match(/(\d{1,3})\s*%/);
    if (star !== null && pctMatch) {
      histogram[star as Star] = Number(pctMatch[1]);
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
    const star = findStarCount(rowText);
    const pctMatch = rowText.match(/(\d{1,3})\s*%/);
    if (star !== null && pctMatch) {
      histogram[star as Star] = Number(pctMatch[1]);
    }
  });

  // Anything less than a plausible, near-complete histogram is discarded: the
  // "no data" state is honest, a partial one actively lies.
  return isPlausibleHistogram(histogram) ? histogram : undefined;
}

// --- Reviews ---------------------------------------------------------------

/**
 * "Reviewed in the United States on June 3, 2026", "Rezension aus Deutschland
 * vom 3. Juni 2026", "2026年6月3日に日本でレビュー済み".
 *
 * Delegated to the language module, which knows the month names for every
 * storefront the manifest matches. The English-only version here returned
 * undefined for French and Japanese dates, which switched off the review-timing
 * and community-response checks entirely on those storefronts — silently, since
 * an undated review is simply skipped.
 */
function parseReviewDate(raw: string): string | undefined {
  return parseLocalisedDate(raw);
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
    sampleSource: detectSampleSource(url),
    language: detectLanguage(doc, url),
    capturedAt: new Date().toISOString(),
  };
}
