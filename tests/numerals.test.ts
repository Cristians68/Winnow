/**
 * Eastern Arabic numerals.
 *
 * `\d` matches neither the Arabic-Indic set (U+0660–U+0669) nor the Extended
 * Arabic-Indic set (U+06F0–U+06F9). Every number the parser reads — rating
 * counts, histogram percentages, helpful votes, the day and year in a review
 * date — would come back zero or undefined on an Arabic storefront.
 *
 * Zero is not a neutral input to this engine. Zero ratings and zero helpful
 * votes are the shapes that make checks fire, so a parse gap here does not
 * degrade to silence, it degrades to a false accusation against a seller. That
 * is the exact failure this codebase has already been bitten by twice, with the
 * histogram columns and with the English-only tokenizer.
 */

import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { fold, normaliseDigits, parseLocalisedDate } from '../src/core/language.js';
import { buildSnapshot } from '../src/content/parse.js';

describe('Eastern Arabic numerals', () => {
  it('maps every Arabic-Indic digit to its ASCII equivalent', () => {
    expect(normaliseDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('maps the Extended Arabic-Indic set used by Persian and Urdu', () => {
    expect(normaliseDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });

  it('leaves ASCII and surrounding text alone', () => {
    expect(normaliseDigits('234 ratings')).toBe('234 ratings');
    expect(normaliseDigits('٢٣٤ تقييم')).toBe('234 تقييم');
  });

  // The assertion that matters. Without normalisation this listing has "no
  // ratings", which is a completely different claim from "234 ratings".
  it('does not read a non-zero rating count as zero', () => {
    expect(Number('٢٣٤')).toBeNaN();
    expect(Number(normaliseDigits('٢٣٤'))).toBe(234);
  });

  it('is reachable through fold, so every downstream reader benefits', () => {
    expect(fold('٢٣٤ نجوم')).toContain('234');
  });

  it('parses an Arabic review date', () => {
    expect(parseLocalisedDate('تمت المراجعة في الإمارات في ١٤ مارس ٢٠٢٦')).toBe('2026-03-14');
  });

  it('parses an Arabic date written with ASCII digits', () => {
    expect(parseLocalisedDate('تمت المراجعة في الإمارات في 14 مارس 2026')).toBe('2026-03-14');
  });
});

// The unit tests above prove normaliseDigits works. They do NOT prove the
// parser uses it: parseCount and parseDecimal read raw text with \d and never
// went through fold. This drives the real parser over a real Arabic page, which
// is the only thing that can tell those two states apart.
describe('the parser reads Arabic numbers off a page', () => {
  const ARABIC_PAGE = `
    <div id="productTitle">مصباح مكتبي</div>
    <span id="acrPopover" title="٤٫٣ من ٥ نجوم"><span class="a-icon-alt">٤٫٣ من ٥ نجوم</span></span>
    <span id="acrCustomerReviewText">٢٣٤ تقييم</span>
  `;

  it('does not report an Arabic rating count as missing', () => {
    const window = new Window({ url: 'https://www.amazon.ae/dp/B0TESTASIN' });
    const doc = window.document as unknown as Document;
    doc.documentElement.setAttribute('lang', 'ar-AE');
    doc.body.innerHTML = ARABIC_PAGE;

    const built = buildSnapshot(doc, 'https://www.amazon.ae/dp/B0TESTASIN');
    expect(built).not.toBeNull();
    expect(built?.totalRatings).toBe(234);
  });

  it('reads the displayed star average written in Arabic digits', () => {
    const window = new Window({ url: 'https://www.amazon.ae/dp/B0TESTASIN' });
    const doc = window.document as unknown as Document;
    doc.documentElement.setAttribute('lang', 'ar-AE');
    doc.body.innerHTML = ARABIC_PAGE;

    const built = buildSnapshot(doc, 'https://www.amazon.ae/dp/B0TESTASIN');
    expect(built?.displayedRating).toBeCloseTo(4.3, 1);
  });
});
