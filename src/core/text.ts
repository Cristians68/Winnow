/** Pure text utilities used by the linguistic signals. No dependencies. */

const WORD_RE = /[a-z0-9']+/g;

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(WORD_RE) ?? [];
}

export function wordCount(text: string): number {
  return tokenize(text).length;
}

/**
 * Character trigrams, used for near-duplicate detection. Character-level
 * shingles beat word-level here because review farms lightly paraphrase.
 */
export function trigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
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

export function sentences(text: string): string[] {
  return text
    .split(/[.!?]+(?:\s|$)/)
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

/** Concrete detail markers: numbers, measurements, dates, model numbers. */
export function specificityMarkers(text: string): number {
  const patterns = [
    /\b\d+(\.\d+)?\s?(inch|inches|cm|mm|ft|lb|lbs|kg|g|oz|ml|l|hours?|days?|weeks?|months?|years?)\b/gi,
    /\b\d+(\.\d+)?%/g,
    /\$\d+(\.\d{2})?/g,
    /\b[A-Z]{2,}[-\s]?\d{2,}\b/g,
  ];
  return patterns.reduce((count, re) => count + (text.match(re)?.length ?? 0), 0);
}

/**
 * Phrases that disclose an incentivised review, or that are template-farm
 * boilerplate. Matched case-insensitively against normalised whitespace.
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

export function matchPhrases(text: string, phrases: string[]): string[] {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  return phrases.filter((phrase) => normalized.includes(phrase));
}

/** Clamp helper used throughout the scoring engine. */
export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}
