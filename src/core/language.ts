/**
 * Locale knowledge for the scoring engine.
 *
 * ## Why this file exists
 *
 * The manifest matches fourteen Amazon storefronts, eleven of which do not
 * serve English. Every text-handling path in the engine was written against
 * English and silently produced wrong answers on the rest:
 *
 *  · The word tokenizer matched `[a-z0-9']+`, so a Japanese review tokenised to
 *    **zero words**. The review-substance check reads a zero word count as "no
 *    written review", so on amazon.co.jp it flagged every five-star review with
 *    a sentence that was simply false about text sitting right there on screen.
 *    German fared little better: "für die Qualität" became `f`, `r`, `qualit`,
 *    `t` — four tokens out of three words, which also corrupts the lexical
 *    diversity the generated-text heuristic depends on.
 *  · Date parsing looked for the English word "on", so French and Japanese
 *    review dates never parsed and two checks went permanently dark.
 *  · The histogram parser required the literal word "star", so the rating
 *    breakdown was unreadable on every non-English storefront.
 *
 * A tool whose entire pitch is calibrated honesty cannot say "5-star rating
 * with no written review" about a paragraph of Japanese. That is the same class
 * of failure as the histogram column bug: **a parsing gap in our own code
 * rendered as a finding about the seller.**
 *
 * ## The boundary this file draws
 *
 * Two categories of language knowledge live here, and they are not equally
 * reliable:
 *
 *  1. **Mechanical** — month names, star nouns, measurement units, script
 *     ranges. These are facts, they are checkable, and they apply to every
 *     storefront listed.
 *  2. **Idiomatic** — the disclosure phrases that reveal an incentivised
 *     review. These are judgement calls about how people actually write, and a
 *     wrong list is worse than no list because it produces confident silence.
 *
 * So category 2 is deliberately incomplete. Where we do not have a phrase list
 * we can stand behind, the language check reports that it could not run, rather
 * than reporting that it found nothing. `LANGUAGES_WITH_PHRASE_LISTS` is the
 * single source of truth for that difference.
 */

/** Languages the engine has any specific knowledge of. */
export type LanguageCode =
  | 'en' | 'de' | 'fr' | 'es' | 'it' | 'nl' | 'sv' | 'pl' | 'ja' | 'hi';

const KNOWN: LanguageCode[] = ['en', 'de', 'fr', 'es', 'it', 'nl', 'sv', 'pl', 'ja', 'hi'];

/**
 * Reduce a BCP-47 tag to a language we know something about.
 *
 * `en-GB`, `EN`, and `en` all mean English. Anything outside the list becomes
 * `null`, which is the honest answer — and callers are expected to degrade
 * rather than guess English, because guessing English is exactly how the
 * original bug shipped.
 */
export function normaliseLanguage(raw: string | null | undefined): LanguageCode | null {
  if (!raw) return null;
  const primary = raw.trim().toLowerCase().split(/[-_]/)[0];
  return KNOWN.includes(primary as LanguageCode) ? (primary as LanguageCode) : null;
}

/**
 * Fold text into a comparable form: lowercase, no Latin diacritics, straight
 * apostrophes, single spaces.
 *
 * The diacritic strip is scoped to U+0300–U+036F, the Latin combining block.
 * Widening it would decompose Japanese dakuten — が is か plus U+3099 — and
 * quietly rewrite the text into a different word. Accent-insensitive matching
 * is worth having for European phrase lists; corrupting Japanese to get it is
 * not.
 *
 * The trailing NFC recomposition matters for the same reason. NFD splits が
 * into two code points, the strip above correctly leaves both alone, and
 * without recomposing, the folded text would carry a decomposed が that no
 * longer compares equal to the composed one. Since folded text is what the
 * duplicate-text check builds its trigrams from, two identical Japanese reviews
 * could otherwise fold into different shingle sets purely by how the page
 * happened to encode them.
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scripts written without spaces between words.
 *
 * Han, Hiragana, Katakana and Thai. A regex word-boundary tokenizer returns
 * either nothing or one enormous token for these, so they need real
 * segmentation — see `tokenize`.
 */
export const UNSEGMENTED_SCRIPT =
  /[぀-ヿ㐀-䶿一-鿿豈-﫿฀-๿]/;

/** Lowercase, unaccented month names, January first. */
export const MONTH_NAMES: Record<LanguageCode, string[]> = {
  en: ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
  de: ['januar', 'februar', 'marz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'],
  fr: ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  it: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
  nl: ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'],
  sv: ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'],
  pl: ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'wrzesnia', 'pazdziernika', 'listopada', 'grudnia'],
  ja: [],
  hi: ['janavari', 'pharavari', 'march', 'aprail', 'mai', 'jun', 'julai', 'agast', 'sitambar', 'aktubar', 'navambar', 'disambar'],
};

/**
 * Month lookup across every language at once, longest name first.
 *
 * Searching all languages rather than only the page's own is deliberate. The
 * page language attribute is occasionally missing or wrong, and a date string
 * carries its own language regardless of what the document claims. Longest
 * first matters because `mars` (fr/sv March) is a prefix of nothing but `marca`
 * (pl) contains `marc`, and a shorter match would win the wrong month.
 */
const MONTH_INDEX: Array<[string, number]> = (() => {
  const seen = new Map<string, number>();
  for (const names of Object.values(MONTH_NAMES)) {
    names.forEach((name, index) => {
      if (name && !seen.has(name)) seen.set(name, index + 1);
    });
  }
  return [...seen.entries()].sort((a, b) => b[0].length - a[0].length);
})();

/**
 * The noun for "star" in each storefront language, plus the CJK character.
 *
 * Used to read the rating histogram, whose labels are the only place the star
 * count appears in words. Both orders occur: "5 stars", but "星5つ".
 */
const STAR_WORDS = [
  'stars', 'star',
  'sterne', 'stern',
  'etoiles', 'etoile',
  'estrellas', 'estrella',
  'stelle', 'stella',
  'sterren', 'ster',
  'stjarnor', 'stjarna',
  'gwiazdek', 'gwiazdki', 'gwiazdka', 'gwiazd',
  '星',
];

const STAR_PATTERN = STAR_WORDS.join('|');

/**
 * Read a star-bucket label like "5 stars", "5 Sterne", "星5つ" or "5 gwiazdek".
 *
 * Returns null for anything that is not unambiguously one bucket label, because
 * this feeds `isPlausibleHistogram`, and a mis-read bucket is the failure mode
 * that once turned a parse error into "100% 5-star with no negative tail".
 */
export function parseStarLabel(raw: string): number | null {
  const text = fold(raw);
  const before = new RegExp(`^([1-5])\\s*(?:${STAR_PATTERN})`, 'u').exec(text);
  if (before) return Number(before[1]);
  const after = new RegExp(`^(?:${STAR_PATTERN})\\s*([1-5])`, 'u').exec(text);
  if (after) return Number(after[1]);
  return null;
}

/**
 * Find a star count inside a longer label, e.g. the accessible description
 * "5 stars represent 78% of rating" or "5 Sterne entsprechen 78 %".
 *
 * Unanchored, so unlike `parseStarLabel` this must not be used to decide that a
 * standalone element *is* a bucket label — only to read the count out of one
 * already known to be a histogram row.
 */
export function findStarCount(raw: string): number | null {
  const text = fold(raw);
  const before = new RegExp(`([1-5])\\s*(?:${STAR_PATTERN})`, 'u').exec(text);
  if (before) return Number(before[1]);
  const after = new RegExp(`(?:${STAR_PATTERN})\\s*([1-5])`, 'u').exec(text);
  if (after) return Number(after[1]);
  return null;
}

/**
 * Parse a review date in any supported storefront language.
 *
 * Three strategies, in order of how much they prove:
 *
 *  1. The CJK numeric form `2026年6月3日`, which is unambiguous.
 *  2. A named month anywhere in the string, paired with a four-digit year and a
 *     one-or-two-digit day. Order-independent, so it reads "June 3, 2026",
 *     "3. Juni 2026" and "3 juin 2026" without needing to know which storefront
 *     produced it.
 *  3. `Date.parse`, which handles English and, by accident of V8's leniency,
 *     some others.
 *
 * Purely numeric dates like `03/06/2026` are deliberately **not** parsed:
 * they mean 3 June in most of Europe and 6 March in the US, and the review
 * timing check would silently mis-order reviews rather than fail. An undated
 * review costs one signal; a wrongly dated one costs the signal's honesty.
 */
export function parseLocalisedDate(raw: string): string | undefined {
  if (!raw) return undefined;

  const cjk = raw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (cjk) return iso(Number(cjk[1]), Number(cjk[2]), Number(cjk[3]));

  const text = fold(raw);
  const year = text.match(/\b(19|20)\d{2}\b/);
  if (year) {
    for (const [name, month] of MONTH_INDEX) {
      const at = text.indexOf(name);
      if (at === -1) continue;
      // The day is the nearest 1-2 digit number that is not the year.
      const day = nearestDay(text, at, year[0]);
      if (day) return iso(Number(year[0]), month, day);
    }
  }

  // ISO order is unambiguous, so it is read directly.
  const isoForm = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoForm) return iso(Number(isoForm[1]), Number(isoForm[2]), Number(isoForm[3]));

  // Anything else that is purely numeric is refused. `03/06/2026` is 3 June on
  // most of the storefronts this extension runs on and 6 March on the largest
  // one, and nothing in the string says which. Handing it to Date.parse — which
  // silently picks the American reading — would let the review-timing check
  // mis-order a sample rather than admit it could not read the dates. An
  // undated review costs one signal; a wrongly dated one costs that signal's
  // honesty, and this project has already been bitten once by a parse failure
  // that presented itself as a finding.
  if (/\d{1,4}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{1,4}/.test(text)) return undefined;

  // Strategy 4. Strip a leading English preamble ("Reviewed in the US on ...")
  // so Date.parse sees only the date part.
  const trailing = raw.match(/\bon\s+(.+)$/i);
  const parsed = Date.parse((trailing?.[1] ?? raw).trim());
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString().slice(0, 10);
}

/** The 1-2 digit number closest to the month name, ignoring the year. */
function nearestDay(text: string, monthAt: number, year: string): number | null {
  let best: { day: number; distance: number } | null = null;
  for (const match of text.matchAll(/\d{1,2}/g)) {
    const at = match.index ?? 0;
    // Skip digits that are part of the year.
    if (at >= text.indexOf(year) && at < text.indexOf(year) + year.length) continue;
    const day = Number(match[0]);
    if (day < 1 || day > 31) continue;
    const distance = Math.abs(at - monthAt);
    if (!best || distance < best.distance) best = { day, distance };
  }
  return best?.day ?? null;
}

function iso(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Reject impossible days that Date would roll forward (31 February).
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString().slice(0, 10);
}

/**
 * Measurement and duration nouns that mark concrete detail in a review.
 *
 * "Died after 3 weeks" is a short review that is obviously real; "great
 * product" is a short review that is obviously nothing. The review-substance
 * check uses these to tell them apart, so a list that only knows English units
 * treats every specific non-English review as contentless.
 */
export const UNIT_WORDS = [
  // English
  'inch', 'inches', 'cm', 'mm', 'ft', 'lb', 'lbs', 'kg', 'g', 'oz', 'ml', 'l',
  'hour', 'hours', 'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years',
  // German
  'zoll', 'stunde', 'stunden', 'tag', 'tage', 'tagen', 'woche', 'wochen', 'monat', 'monate', 'monaten', 'jahr', 'jahre', 'jahren',
  // French
  'heure', 'heures', 'jour', 'jours', 'semaine', 'semaines', 'mois', 'an', 'ans', 'annee', 'annees',
  // Spanish
  'hora', 'horas', 'dia', 'dias', 'semana', 'semanas', 'mes', 'meses', 'ano', 'anos',
  // Italian
  'ora', 'ore', 'giorno', 'giorni', 'settimana', 'settimane', 'mese', 'mesi', 'anno', 'anni',
  // Dutch
  'uur', 'dag', 'dagen', 'week', 'weken', 'maand', 'maanden', 'jaar', 'jaren',
  // Swedish
  'timme', 'timmar', 'dagar', 'vecka', 'veckor', 'manad', 'manader', 'ar',
  // Polish
  'godzina', 'godziny', 'dzien', 'dni', 'tydzien', 'tygodnie', 'miesiac', 'miesiace', 'rok', 'lata',
];

/** CJK units, which attach to the number with no space and no word boundary. */
export const CJK_UNIT_PATTERN =
  /\d+\s*(?:年|ヶ月|カ月|か月|ヵ月|个月|週間|周|週|日間|日|時間|分|秒|センチ|ミリ|キロ|グラム|回|個|台|本)/g;

/** Currency amounts are concrete detail in any language. */
export const CURRENCY_PATTERN = /(?:[$€£¥₹]\s?\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s?(?:€|£|¥|₹|zl|kr|eur|usd|gbp))/gi;

/**
 * Languages whose incentive and boilerplate phrase lists we are willing to
 * stand behind.
 *
 * Everything not listed here makes the review-language check report that it
 * could not run. That is the whole point: an empty phrase list matched against
 * a Japanese review returns no matches, and "no matches" rendered as "No
 * incentive disclosures found" is a false all-clear — the single most damaging
 * output this product can produce, because it is indistinguishable from a real
 * one.
 */
export const LANGUAGES_WITH_PHRASE_LISTS: LanguageCode[] = ['en', 'de', 'fr', 'es', 'it'];

export function hasPhraseList(language: LanguageCode | null): boolean {
  return language !== null && LANGUAGES_WITH_PHRASE_LISTS.includes(language);
}
