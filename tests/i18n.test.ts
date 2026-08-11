/**
 * Non-English storefronts.
 *
 * The manifest matches twenty Amazon domains, twelve of which do not serve
 * English, and every text path in the engine was written against English. These
 * tests pin the four places that produced *wrong answers* rather than missing
 * ones, because a wrong answer here is a false accusation against a seller and
 * a false reassurance to a shopper.
 *
 * Each block states the pre-fix behaviour it exists to prevent. Every one of
 * them was reproduced against the previous code before the fix went in — a test
 * that passes against both versions is measuring nothing.
 */

import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';

import {
  fold,
  findStarCount,
  normaliseLanguage,
  parseLocalisedDate,
  parseStarLabel,
} from '../src/core/language.js';
import { sentences, specificityMarkers, tokenize, wordCount } from '../src/core/text.js';
import { depthSignal } from '../src/core/signals/depth.js';
import { phrasingSignal } from '../src/core/signals/phrasing.js';
import { analyse } from '../src/core/score.js';
import { buildSnapshot, detectLanguage, extractHistogram } from '../src/content/parse.js';
import { MARKETPLACES, marketplaceFor } from '../src/core/marketplaces.js';
import type { ProductSnapshot, Review, Star } from '../src/core/types.js';

const JAPANESE_REVIEW =
  'このライトは非常に明るくて、寝室で毎晩使っています。三週間使いましたが、電池の持ちもよく、とても満足しています。';
const GERMAN_REVIEW =
  'Für den Preis ist die Qualität überraschend gut, größer als erwartet und nach 3 Wochen läuft alles noch einwandfrei.';

function review(partial: Partial<Review> & { id: string }): Review {
  return {
    rating: 5,
    verified: true,
    text: 'A perfectly ordinary review with a reasonable amount of detail in it.',
    helpfulVotes: 3,
    ...partial,
  };
}

function snapshot(reviews: Review[], extra: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    asin: 'B000000001',
    displayedRating: 4.6,
    totalRatings: 1200,
    histogram: { 5: 62, 4: 16, 3: 9, 2: 6, 1: 7 },
    capturedAt: new Date().toISOString(),
    reviews,
    ...extra,
  };
}

// --------------------------------------------------------------------------

describe('tokenizer', () => {
  // Pre-fix: /[a-z0-9']+/ returned [] for Japanese, so every Japanese review
  // had a word count of zero.
  it('counts words in a script that is written without spaces', () => {
    expect(wordCount(JAPANESE_REVIEW)).toBeGreaterThan(10);
  });

  // Pre-fix: "für die Qualität" tokenised to f, r, die, qualit, t.
  it('keeps accented words whole instead of splitting them at the accent', () => {
    const tokens = tokenize('Für die Qualität');
    expect(tokens).toEqual(['fur', 'die', 'qualitat']);
  });

  it('keeps internal apostrophes, straight or typographic', () => {
    expect(tokenize("l’appareil n'est")).toEqual(["l'appareil", "n'est"]);
  });

  // Pre-fix: no CJK terminator in the split, so a Japanese paragraph was one
  // sentence and the rhythm heuristic could never see enough of them.
  it('splits CJK sentences on their own terminators', () => {
    expect(sentences('これは良い。とても軽い。毎日使う。').length).toBe(3);
  });

  it('still treats a decimal point as part of a number, not a sentence end', () => {
    expect(sentences('It is 3.5 inches wide and fits fine.').length).toBe(1);
  });
});

describe('concrete-detail markers', () => {
  it('recognises durations and measurements outside English', () => {
    expect(specificityMarkers('nach 3 Wochen')).toBeGreaterThan(0);
    expect(specificityMarkers('après 2 semaines')).toBeGreaterThan(0);
    expect(specificityMarkers('dopo 6 mesi')).toBeGreaterThan(0);
    expect(specificityMarkers('三週間使いました 2週間')).toBeGreaterThan(0);
  });

  it('recognises non-dollar currency amounts', () => {
    expect(specificityMarkers('kostet nur 12,99 €')).toBeGreaterThan(0);
    expect(specificityMarkers('worth £15 easily')).toBeGreaterThan(0);
  });

  it('does not treat ordinary prose as concrete detail', () => {
    expect(specificityMarkers('It is a very good product and I like it a lot.')).toBe(0);
  });
});

describe('review substance on a non-English storefront', () => {
  /**
   * The defect this whole file exists for.
   *
   * A Japanese five-star review with a paragraph of text scored zero words, and
   * the substance check renders a zero word count as "5-star rating with no
   * written review". That sentence was printed to the user about text that was
   * plainly on the screen, and it pushed real listings toward a worse grade.
   */
  it('does not report a paragraph of Japanese as an empty review', () => {
    const flagged = depthSignal.evaluate(
      snapshot([review({ id: 'r1', rating: 5, text: JAPANESE_REVIEW })], { language: 'ja' }),
    );
    expect(flagged.has('r1')).toBe(false);
  });

  it('does not report a detailed German review as contentless', () => {
    const flagged = depthSignal.evaluate(
      snapshot([review({ id: 'r1', rating: 5, text: GERMAN_REVIEW })], { language: 'de' }),
    );
    expect(flagged.has('r1')).toBe(false);
  });

  it('still catches a genuinely empty five-star review in any language', () => {
    const flagged = depthSignal.evaluate(
      snapshot([review({ id: 'r1', rating: 5, text: '' })], { language: 'ja' }),
    );
    expect(flagged.get('r1')?.reason).toContain('no written review');
  });

  // The end-to-end version: the grade itself must not move because of the
  // parser's blind spot.
  // Note the bodies below are all genuinely different sentences. Padding one
  // string with a repeated character produces near-identical trigram sets and
  // trips the duplicate-text check, which is correct behaviour and would have
  // masked what this test is actually measuring.
  const JAPANESE_BODIES = [
    'このライトは非常に明るくて、寝室で毎晩使っています。三週間使いましたが電池の持ちもよいです。',
    '梱包が丁寧で、届いた箱に傷ひとつありませんでした。組み立ては十分ほどで終わりました。',
    '思っていたより軽く、片手でも楽に持ち運べます。旅行にも持って行くつもりです。',
    '説明書が少し分かりにくかったものの、動作そのものには全く問題がありません。',
    '色は写真より少し暗めですが、部屋の家具とよく合っていて気に入っています。',
    '前に買った安い製品はすぐ壊れました。こちらは作りがしっかりしていて安心感があります。',
    '音が静かなので、夜遅くに使っても家族を起こす心配がないのが助かります。',
    '価格を考えれば十分な品質だと思います。二台目の購入も検討しているところです。',
  ];

  it('grades a clean Japanese listing without discounting a single review', () => {
    const japanese = analyse(
      snapshot(
        JAPANESE_BODIES.map((text, i) => review({ id: `r${i}`, rating: 5, text })),
        { language: 'ja' },
      ),
    );
    expect(japanese.discountedCount).toBe(0);
    expect(['A', 'B']).toContain(japanese.grade);
  });
});

describe('the wording check refuses to run where it cannot see', () => {
  /**
   * The quiet version of the same failure. Incentive-disclosure detection is
   * made of English phrases; run against Japanese it matches nothing, and
   * "nothing matched" was rendered as "No incentive disclosures, boilerplate or
   * generated-text patterns found" — a clean bill of health from a check that
   * never looked, and indistinguishable from a real one.
   */
  it('reports that it was skipped rather than passing on an unsupported language', () => {
    const analysis = analyse(
      snapshot(
        Array.from({ length: 6 }, (_, i) => review({ id: `r${i}`, text: JAPANESE_REVIEW + i })),
        { language: 'ja' },
      ),
    );
    const phrasing = analysis.signals.find((s) => s.id === 'phrasing')!;
    expect(phrasing.status).toBe('insufficient-data');
    expect(phrasing.detail).toMatch(/skipped/i);
    expect(phrasing.detail).not.toMatch(/no incentive disclosures/i);
  });

  it('says so differently when the page never declared a language at all', () => {
    expect(phrasingSignal.unavailable!(snapshot([]))).toMatch(/couldn't tell what language/i);
  });

  it('runs normally on English', () => {
    expect(phrasingSignal.unavailable!(snapshot([], { language: 'en-GB' }))).toBeNull();
  });

  it('catches a disclosed incentive in the languages it does cover', () => {
    const cases: Array<[string, string]> = [
      ['en', 'I received this product for free in exchange for my honest review.'],
      ['de', 'Ich habe das Produkt im Austausch für eine ehrliche Bewertung erhalten.'],
      ['fr', "J'ai reçu ce produit gratuitement pour tester, en échange d'un avis honnête."],
      ['es', 'Recibí este producto gratis a cambio de una opinión honesta.'],
      ['it', 'Ho ricevuto questo prodotto gratuitamente in cambio di una recensione onesta.'],
    ];

    for (const [language, text] of cases) {
      const flagged = phrasingSignal.evaluate(
        snapshot([review({ id: 'r1', text })], { language }),
      );
      expect(flagged.get('r1')?.reason, language).toContain('free or discounted');
    }
  });

  it('matches disclosures written with accents and typographic apostrophes', () => {
    const flagged = phrasingSignal.evaluate(
      snapshot([review({ id: 'r1', text: "Produit reçu en échange d’un avis honnête." })], {
        language: 'fr',
      }),
    );
    expect(flagged.has('r1')).toBe(true);
  });

  // A check that cannot run must not silently contribute suspicion either.
  it('contributes no suspicion while unavailable', () => {
    const withIncentiveText = snapshot(
      [review({ id: 'r1', text: 'in exchange for my honest review'.repeat(3) })],
      { language: 'ja' },
    );
    expect(phrasingSignal.evaluate(withIncentiveText).size).toBe(0);
  });
});

describe('dates', () => {
  const cases: Array<[string, string | undefined]> = [
    ['Reviewed in the United States on June 3, 2026', '2026-06-03'],
    ['Rezension aus Deutschland vom 3. Juni 2026', '2026-06-03'],
    ['Commentaire laissé en France le 3 juin 2026', '2026-06-03'],
    ['Opinión valorada en España el 3 de junio de 2026', '2026-06-03'],
    ['Recensito in Italia il 3 giugno 2026', '2026-06-03'],
    ['Beoordeeld in Nederland op 3 juni 2026', '2026-06-03'],
    ['Recension i Sverige den 3 juni 2026', '2026-06-03'],
    ['Zrecenzowano w Polsce 3 czerwca 2026', '2026-06-03'],
    ['2026年6月3日に日本でレビュー済み', '2026-06-03'],
  ];

  for (const [raw, expected] of cases) {
    it(`reads ${JSON.stringify(raw.slice(0, 28))}`, () => {
      expect(parseLocalisedDate(raw)).toBe(expected);
    });
  }

  /**
   * 03/06/2026 is 3 June in Europe and 6 March in the US, and nothing in the
   * string says which. The review-timing check would silently mis-order the
   * sample rather than fail, so this stays unparsed on purpose: an undated
   * review costs one signal, a wrongly dated one costs the signal's honesty.
   */
  it('refuses a bare numeric date rather than guessing the field order', () => {
    expect(parseLocalisedDate('03/06/2026')).toBeUndefined();
  });

  it('rejects a day that does not exist rather than rolling it forward', () => {
    expect(parseLocalisedDate('31 February 2026')).toBeUndefined();
  });

  it('returns undefined for text with no date in it', () => {
    expect(parseLocalisedDate('Verified Purchase')).toBeUndefined();
  });
});

describe('star labels', () => {
  const labels: Array<[string, number]> = [
    ['5 stars', 5],
    ['4 Sterne', 4],
    ['3 étoiles', 3],
    ['2 estrellas', 2],
    ['1 stella', 1],
    ['5 sterren', 5],
    ['4 stjärnor', 4],
    ['3 gwiazdek', 3],
    ['星5つ', 5],
  ];

  for (const [label, expected] of labels) {
    it(`reads ${label}`, () => expect(parseStarLabel(label)).toBe(expected));
  }

  it('does not read a percentage as a bucket label', () => {
    expect(parseStarLabel('78%')).toBeNull();
  });

  it('does not treat arbitrary text as a bucket label', () => {
    expect(parseStarLabel('See all reviews')).toBeNull();
  });

  it('finds the count inside a longer accessible label', () => {
    expect(findStarCount('5 Sterne entsprechen 78 % der Bewertungen')).toBe(5);
    expect(findStarCount('5 stars represent 78% of rating')).toBe(5);
  });
});

describe('histogram on a German storefront', () => {
  // Pre-fix: the histogram required the literal word "star", so it was
  // unreadable on eleven of the fourteen domains the manifest matched then, and the
  // rating-distribution check reported no data on all of them.
  it('reads a column-laid-out German histogram', () => {
    const window = new Window({ url: 'https://www.amazon.de/dp/B000000001' });
    const doc = window.document as unknown as Document;
    doc.body.innerHTML = `
      <ul id="histogramTable">
        <li><span>5 Sterne</span></li>
        <li><span>4 Sterne</span></li>
        <li><span>3 Sterne</span></li>
        <li><span>2 Sterne</span></li>
        <li><span>1 Stern</span></li>
        <li><span>62%</span></li>
        <li><span>16%</span></li>
        <li><span>9%</span></li>
        <li><span>6%</span></li>
        <li><span>7%</span></li>
      </ul>`;

    expect(extractHistogram(doc)).toEqual({ 5: 62, 4: 16, 3: 9, 2: 6, 1: 7 });
  });
});

describe('language detection', () => {
  it('prefers what the page says about itself', () => {
    const window = new Window({ url: 'https://www.amazon.ca/dp/B000000001' });
    const doc = window.document as unknown as Document;
    doc.documentElement.setAttribute('lang', 'fr-CA');
    expect(detectLanguage(doc, 'https://www.amazon.ca/dp/B000000001')).toBe('fr-CA');
  });

  it('falls back to the storefront when the page says nothing', () => {
    const window = new Window({ url: 'https://www.amazon.co.jp/dp/B000000001' });
    const doc = window.document as unknown as Document;
    doc.documentElement.removeAttribute('lang');
    expect(detectLanguage(doc, 'https://www.amazon.co.jp/dp/B000000001')).toBe('ja');
  });

  it('normalises regional tags and rejects unknown ones', () => {
    expect(normaliseLanguage('de-DE')).toBe('de');
    expect(normaliseLanguage('EN')).toBe('en');
    // pt-BR used to stand in for "unknown" here. It is a storefront language
    // now, so the case has to be carried by a tag that is still genuinely
    // outside the tables — otherwise this assertion quietly stops testing the
    // boundary it was written for.
    expect(normaliseLanguage('ko-KR')).toBeNull();
    expect(normaliseLanguage('zh-CN')).toBeNull();
    expect(normaliseLanguage(undefined)).toBeNull();
  });

  it('records the language on the snapshot the engine receives', () => {
    const window = new Window({ url: 'https://www.amazon.de/dp/B0TESTASIN' });
    const doc = window.document as unknown as Document;
    doc.documentElement.setAttribute('lang', 'de-de');
    doc.body.innerHTML = '<div id="productTitle">Testprodukt</div>';

    const built = buildSnapshot(doc, 'https://www.amazon.de/dp/B0TESTASIN');
    expect(built?.language).toBe('de-de');
  });
});

describe('folding', () => {
  it('strips Latin accents without touching Japanese voiced marks', () => {
    expect(fold('Qualität')).toBe('qualitat');
    // が must survive as one character: NFD splits it into か + U+3099, and a
    // wider combining-mark strip would silently rewrite the word.
    expect(fold('がぎ')).toBe('がぎ');
  });
});

describe('the rest of the engine still works in English', () => {
  it('flags an English incentive disclosure end to end', () => {
    const reviews: Review[] = Array.from({ length: 6 }, (_, i) =>
      review({
        id: `r${i}`,
        text: `I received this product for free in exchange for my honest review, number ${i}, and it is fine.`,
        rating: 5 as Star,
      }),
    );
    const analysis = analyse(snapshot(reviews, { language: 'en' }));
    const phrasing = analysis.signals.find((s) => s.id === 'phrasing')!;
    expect(phrasing.status).toBe('fail');
    expect(analysis.discountedCount).toBe(6);
  });
});

describe('language fallback comes from the storefront registry', () => {
  const docFor = (url: string): Document => {
    const window = new Window({ url });
    const doc = window.document as unknown as Document;
    doc.documentElement.removeAttribute('lang');
    return doc;
  };

  // amazon.com.mx was missing from the hand-written DOMAIN_LANGUAGE table, so a
  // Mexican page served without a lang attribute reported no language at all
  // and the wording check went dark without saying so. The registry cannot
  // develop that gap: a storefront that names no language does not compile.
  it('knows amazon.com.mx speaks Spanish', () => {
    expect(detectLanguage(docFor('https://www.amazon.com.mx/dp/B000000001'), 'https://www.amazon.com.mx/dp/B000000001')).toBe('es');
  });

  it('still resolves the storefronts it always did', () => {
    for (const [url, language] of [
      ['https://www.amazon.de/dp/B000000001', 'de'],
      ['https://www.amazon.co.jp/dp/B000000001', 'ja'],
      ['https://www.amazon.se/dp/B000000001', 'sv'],
    ] as const) {
      expect(detectLanguage(docFor(url), url), url).toBe(language);
    }
  });

  it('returns undefined for a host it does not know, rather than guessing English', () => {
    const url = 'https://example.com/dp/B000000001';
    expect(detectLanguage(docFor(url), url)).toBeUndefined();
  });

  it('refuses a lookalike domain the old substring guard would have accepted', () => {
    const url = 'https://www.amazon.evil.com/dp/B000000001';
    expect(detectLanguage(docFor(url), url)).toBeUndefined();
  });
});

describe('Portuguese and Turkish storefronts', () => {
  it('recognises the language codes', () => {
    expect(normaliseLanguage('pt-BR')).toBe('pt');
    expect(normaliseLanguage('tr-TR')).toBe('tr');
  });

  it('parses Portuguese review dates', () => {
    expect(parseLocalisedDate('Avaliado no Brasil em 14 de marco de 2026')).toBe('2026-03-14');
    expect(parseLocalisedDate('Avaliado no Brasil em 2 de setembro de 2025')).toBe('2025-09-02');
  });

  it('parses Turkish review dates', () => {
    expect(parseLocalisedDate("Turkiye'de 5 Agustos 2026 tarihinde incelendi")).toBe('2026-08-05');
    expect(parseLocalisedDate("Turkiye'de 11 Subat 2025 tarihinde incelendi")).toBe('2025-02-11');
  });

  it('reads Portuguese and Turkish histogram star labels', () => {
    expect(findStarCount('5 estrelas')).toBe(5);
    expect(findStarCount('1 estrela')).toBe(1);
    expect(findStarCount('5 yildiz')).toBe(5);
  });

  // The dotted/dotless i is the Turkish trap. NFD does not reduce U+0131 to
  // ASCII, so without an explicit mapping 'yıldız' folds to itself and never
  // matches the star noun -- which makes the rating histogram unreadable on
  // amazon.com.tr, the exact silent blindness this file exists to prevent.
  it('folds the Turkish dotless i so star labels still match', () => {
    expect(fold('5 yıldız')).toBe('5 yildiz');
    expect(findStarCount('5 yıldız')).toBe(5);
    expect(findStarCount('1 yıldız')).toBe(1);
  });

  it('parses a Turkish date written with real Turkish letters', () => {
    expect(parseLocalisedDate("Türkiye'de 5 Ağustos 2026 tarihinde incelendi")).toBe('2026-08-05');
  });

  it('parses a Portuguese date written with real accents', () => {
    expect(parseLocalisedDate('Avaliado no Brasil em 14 de março de 2026')).toBe('2026-03-14');
  });

  it('tokenises Portuguese and Turkish without shattering words', () => {
    expect(tokenize('produto de ótima qualidade não recomendo')).toHaveLength(6);
    expect(tokenize('yıldız ürün kalitesi çok iyi')).toHaveLength(5);
  });
});

describe('the five new storefronts', () => {
  it('are in the registry with languages the engine knows', () => {
    const hosts = MARKETPLACES.map((m) => m.host);
    for (const host of ['amazon.com.br', 'amazon.sg', 'amazon.com.tr', 'amazon.ie', 'amazon.com.be']) {
      expect(hosts, host).toContain(host);
    }
    expect(marketplaceFor('www.amazon.com.br')?.languages[0]).toBe('pt');
    expect(marketplaceFor('www.amazon.com.tr')?.languages[0]).toBe('tr');
    expect(marketplaceFor('www.amazon.com.be')?.languages).toEqual(['fr', 'nl']);
    expect(marketplaceFor('www.amazon.sg')?.languages).toEqual(['en']);
    expect(marketplaceFor('www.amazon.ie')?.languages).toEqual(['en']);
  });
});
