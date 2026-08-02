/** Pure text utilities used by the linguistic signals. No dependencies. */

import {
  CJK_UNIT_PATTERN,
  CURRENCY_PATTERN,
  UNIT_WORDS,
  UNSEGMENTED_SCRIPT,
  fold,
  type LanguageCode,
} from './language.js';

/**
 * A word: letters or digits in any script, with internal apostrophes kept so
 * "don't" and "l'appareil" stay single tokens.
 *
 * This used to be `/[a-z0-9']+/g`, which silently defined "word" as "English
 * word". Accented Latin text shattered into fragments — "für die Qualität"
 * tokenised to f, r, die, qualit, t — and non-Latin scripts produced nothing at
 * all. Both outcomes feed the review-substance check, which reads a low word
 * count as an empty review, so the tokenizer was manufacturing findings out of
 * its own blind spots. See src/core/language.ts for the full account.
 */
const WORD_RE = /[\p{L}\p{N}]+(?:['][\p{L}\p{N}]+)*/gu;

/**
 * Split text into words, segmenting scripts that do not use spaces.
 *
 * Japanese, Chinese and Thai write without word delimiters, so a regex
 * tokenizer returns one enormous token for a whole sentence — no better than
 * the zero it used to return. `Intl.Segmenter` does the real work when the
 * runtime has it (Chrome 87+, which is well below anything running MV3), and
 * the regex remains the fallback so this file keeps working anywhere.
 */
export function tokenize(text: string): string[] {
  const normalised = fold(text);
  if (!normalised) return [];

  if (UNSEGMENTED_SCRIPT.test(normalised) && typeof Intl?.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    return [...segmenter.segment(normalised)]
      .filter((segment) => segment.isWordLike)
      .map((segment) => segment.segment);
  }

  return normalised.match(WORD_RE) ?? [];
}

export function wordCount(text: string): number {
  return tokenize(text).length;
}

/**
 * Character trigrams, used for near-duplicate detection. Character-level
 * shingles beat word-level here because review farms lightly paraphrase.
 */
export function trigrams(text: string): Set<string> {
  // Folded, so two reviews that differ only in accents or in straight versus
  // curly apostrophes still register as the near-duplicates they are.
  const normalized = fold(text);
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= normalized.length; i++) {
    grams.add(normalized.slice(i, i + 3));
  }
  return grams;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) {
    if (large.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Type-token ratio, corrected for length. Genuine reviews of similar length
 * vary; template and LLM-generated text tends toward a narrower band.
 */
export function lexicalDiversity(text: string): number {
  const tokens = tokenize(text);
  if (tokens.length < 5) return 1;
  const unique = new Set(tokens).size;
  // Root TTR (Guiraud's index) normalised into roughly 0-1 for review-length text.
  const guiraud = unique / Math.sqrt(tokens.length);
  return Math.min(1, guiraud / 7);
}

/**
 * Sentence split. CJK terminators are included because the rhythm heuristic
 * that consumes this treats "fewer than three sentences" as "cannot judge", and
 * a Japanese paragraph has none of `.!?` in it — so every such review looked
 * like a single sentence and the check quietly never ran.
 */
export function sentences(text: string): string[] {
  return text
    // Latin terminators need a following space so "3.5 inches" stays one
    // sentence; CJK terminators are never followed by one, so they split alone.
    .split(/[.!?]+(?:\s|$)|[。！？]+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Coefficient of variation of sentence lengths. Human writing is bursty;
 * generated text is metronomic. Lower = more uniform = more suspicious.
 */
export function sentenceLengthVariation(text: string): number {
  const lengths = sentences(text).map((s) => tokenize(s).length);
  if (lengths.length < 3) return 1;
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (mean === 0) return 1;
  const variance =
    lengths.reduce((acc, len) => acc + (len - mean) ** 2, 0) / lengths.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Concrete detail markers: measurements, durations, prices, model numbers.
 *
 * This is what stops the review-substance check from condemning a short but
 * real review — "died after 3 weeks" is six words of genuine information. The
 * unit list therefore has to cover every storefront language, or a specific
 * German review reads as contentless for the sole reason that it says "Wochen".
 */
const UNIT_PATTERN = new RegExp(
  String.raw`\b\d+([.,]\d+)?\s?(${UNIT_WORDS.join('|')})\b`,
  'gi',
);

export function specificityMarkers(text: string): number {
  const folded = fold(text);
  const patterns: Array<[string, RegExp]> = [
    ['units', UNIT_PATTERN],
    ['cjk-units', CJK_UNIT_PATTERN],
    ['percent', /\d+([.,]\d+)?\s?%/g],
    ['currency', CURRENCY_PATTERN],
    // Model numbers: "WH-1000XM4", "AA 3000". Case is meaningful here, so this
    // one runs against the original text rather than the folded copy.
    ['model', /\b\p{Lu}{2,}[-\s]?\d{2,}\b/gu],
  ];

  return patterns.reduce((count, [kind, pattern]) => {
    const subject = kind === 'model' ? text : folded;
    return count + (subject.match(pattern)?.length ?? 0);
  }, 0);
}

/**
 * Phrases that disclose an incentivised review, or that are template-farm
 * boilerplate.
 *
 * Matched against folded text — lowercase, no Latin accents, straight
 * apostrophes — so "en échange d'un avis honnête" matches whether the page
 * used a typographic apostrophe or not. The lists below are therefore written
 * unaccented on purpose; adding an accent would make the entry unmatchable.
 *
 * These exports remain the English lists so existing callers and tests are
 * unaffected; `incentivePhrasesFor` / `templatePhrasesFor` select by language.
 */
export const INCENTIVE_PHRASES = [
  'in exchange for my honest review',
  'in exchange for an honest review',
  'received this product for free',
  'received this item for free',
  'at a discounted price in exchange',
  'free product in exchange',
  'discounted price for my honest',
  'i received this product at a discount',
  'in return for my unbiased review',
  'for testing and reviewing purposes',
  'sent to me free of charge',
];

export const TEMPLATE_PHRASES = [
  'highly recommend this product',
  'exceeded my expectations',
  'exactly as described',
  'great value for the money',
  'works as expected',
  'good quality product',
  'i love this product',
  'five stars',
  'best purchase ever',
  'would buy again',
  'arrived quickly and',
  'great product great price',
];

/**
 * Per-language phrase lists.
 *
 * Only the five languages in `LANGUAGES_WITH_PHRASE_LISTS` appear here, and
 * that is the honest boundary rather than a to-do: running an empty list
 * against a Japanese review returns no matches, and reporting no matches as
 * "No incentive disclosures found" is a false all-clear indistinguishable from
 * a true one. The signal reports that it could not run instead — see
 * `phrasingSignal.unavailable`.
 */
const INCENTIVE_BY_LANGUAGE: Partial<Record<LanguageCode, string[]>> = {
  en: INCENTIVE_PHRASES,
  de: [
    'im austausch fur eine ehrliche bewertung',
    'im austausch fur eine ehrliche rezension',
    'gegen eine ehrliche bewertung',
    'kostenlos zur verfugung gestellt',
    'kostenlos erhalten',
    'zu testzwecken erhalten',
    'vergunstigt erhalten',
    'als testmuster erhalten',
  ],
  fr: [
    "en echange d'un avis honnete",
    "en echange d'un commentaire honnete",
    'recu ce produit gratuitement',
    'produit offert en echange',
    'a prix reduit en echange',
    'a titre gracieux en echange',
    'recu gratuitement pour tester',
  ],
  es: [
    'a cambio de una opinion honesta',
    'a cambio de una resena honesta',
    'recibi este producto gratis',
    'producto gratuito a cambio',
    'con descuento a cambio de',
    'me lo enviaron gratis',
  ],
  it: [
    'in cambio di una recensione onesta',
    'in cambio di un parere onesto',
    'ricevuto questo prodotto gratuitamente',
    'prodotto omaggio in cambio',
    'a prezzo scontato in cambio',
    'ricevuto gratis per provarlo',
  ],
};

const TEMPLATE_BY_LANGUAGE: Partial<Record<LanguageCode, string[]>> = {
  en: TEMPLATE_PHRASES,
  de: [
    'kann ich nur weiterempfehlen',
    'hat meine erwartungen ubertroffen',
    'genau wie beschrieben',
    'sehr gutes preis leistungs verhaltnis',
    'funktioniert wie erwartet',
    'gute qualitat zu einem guten preis',
    'wurde ich wieder kaufen',
    'schnelle lieferung und',
  ],
  fr: [
    'je recommande vivement ce produit',
    'a depasse mes attentes',
    'conforme a la description',
    'tres bon rapport qualite prix',
    'fonctionne comme prevu',
    'je le racheterais sans hesiter',
    'livraison rapide et',
  ],
  es: [
    'lo recomiendo totalmente',
    'supero mis expectativas',
    'tal y como se describe',
    'muy buena relacion calidad precio',
    'funciona como se esperaba',
    'lo volveria a comprar',
    'entrega rapida y',
  ],
  it: [
    'lo consiglio vivamente',
    'ha superato le mie aspettative',
    'esattamente come descritto',
    'ottimo rapporto qualita prezzo',
    'funziona come previsto',
    'lo ricomprerei sicuramente',
    'consegna rapida e',
  ],
};

export function incentivePhrasesFor(language: LanguageCode | null): string[] {
  return (language && INCENTIVE_BY_LANGUAGE[language]) ?? [];
}

export function templatePhrasesFor(language: LanguageCode | null): string[] {
  return (language && TEMPLATE_BY_LANGUAGE[language]) ?? [];
}

export function matchPhrases(text: string, phrases: string[]): string[] {
  const normalized = fold(text);
  return phrases.filter((phrase) => normalized.includes(phrase));
}

/** Clamp helper used throughout the scoring engine. */
export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}
