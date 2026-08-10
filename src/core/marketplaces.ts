/**
 * The storefronts Winnow runs on, and what the engine must know about each.
 *
 * ## Why this file exists
 *
 * Before it, the list of Amazon storefronts lived in five places that could
 * disagree without anything failing:
 *
 *   1. `host_permissions` in the manifest
 *   2. `content_scripts.matches` in the manifest
 *   3. `ALLOWED_HOSTS` in package.mjs
 *   4. `DOMAIN_LANGUAGE` in src/content/parse.ts
 *   5. the locale tables in src/core/language.ts, keyed by language with no
 *      mechanical link back to the storefronts that need them
 *
 * Number 5 is how the v0.3.0 localisation bug shipped. Fourteen storefronts
 * were added and nothing required that adding one also meant supplying its
 * month names and star nouns, so eleven of them ran an English tokenizer over
 * non-English text and reported the resulting silence as findings about the
 * seller. Number 4 had already quietly drifted too: amazon.com.mx, a Spanish
 * storefront, was missing from it entirely, so a Mexican page served without a
 * `lang` attribute reported no language at all and the wording check went dark
 * without saying so.
 *
 * The fix is not vigilance, it is a type. `languages` is required and typed as
 * `LanguageCode`, so a storefront cannot be added to this array until the
 * engine actually has tables for what it speaks. The class of bug becomes a
 * compile error.
 */

import type { LanguageCode } from './language.js';

export interface Marketplace {
  /** Registrable domain, e.g. 'amazon.co.jp'. Not a match pattern. */
  host: string;
  /**
   * Languages this storefront serves, most common first.
   *
   * Only a fallback: `detectLanguage` prefers the document's own `lang`
   * attribute, because any user can switch language on any storefront and the
   * page's statement about itself beats our guess from the domain.
   */
  languages: LanguageCode[];
  /** ISO 3166-1 alpha-2. Display only — nothing branches on it. */
  region: string;
}

export const MARKETPLACES: Marketplace[] = [
  { host: 'amazon.com', languages: ['en'], region: 'US' },
  { host: 'amazon.co.uk', languages: ['en'], region: 'GB' },
  { host: 'amazon.ca', languages: ['en', 'fr'], region: 'CA' },
  { host: 'amazon.de', languages: ['de'], region: 'DE' },
  { host: 'amazon.fr', languages: ['fr'], region: 'FR' },
  { host: 'amazon.es', languages: ['es'], region: 'ES' },
  { host: 'amazon.it', languages: ['it'], region: 'IT' },
  { host: 'amazon.com.au', languages: ['en'], region: 'AU' },
  { host: 'amazon.co.jp', languages: ['ja'], region: 'JP' },
  { host: 'amazon.in', languages: ['en', 'hi'], region: 'IN' },
  { host: 'amazon.com.mx', languages: ['es'], region: 'MX' },
  { host: 'amazon.nl', languages: ['nl'], region: 'NL' },
  { host: 'amazon.se', languages: ['sv'], region: 'SE' },
  { host: 'amazon.pl', languages: ['pl'], region: 'PL' },
  { host: 'amazon.com.br', languages: ['pt'], region: 'BR' },
  { host: 'amazon.sg', languages: ['en'], region: 'SG' },
  { host: 'amazon.com.tr', languages: ['tr'], region: 'TR' },
  { host: 'amazon.ie', languages: ['en'], region: 'IE' },
  { host: 'amazon.com.be', languages: ['fr', 'nl'], region: 'BE' },
];

/**
 * Resolve a hostname to its storefront.
 *
 * Matches on a dot-anchored suffix so `amazon.evil.com` cannot resolve, and
 * takes the longest match so `amazon.com.au` never falls through to
 * `amazon.com`. Returns null for anything unrecognised, which callers must
 * treat as "no locale knowledge" rather than defaulting to English — guessing
 * English is exactly how the original bug shipped.
 */
export function marketplaceFor(hostname: string): Marketplace | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  let best: Marketplace | null = null;
  for (const market of MARKETPLACES) {
    if (host === market.host || host.endsWith(`.${market.host}`)) {
      if (!best || market.host.length > best.host.length) best = market;
    }
  }
  return best;
}

/** Manifest match patterns, one per storefront. */
export function matchPatterns(): string[] {
  return MARKETPLACES.map((market) => `*://*.${market.host}/*`);
}

/**
 * Whether a manifest host pattern is one this registry would have produced.
 *
 * The packaging guard this replaces tested `/amazon\./`, unanchored, which
 * happily passed `*://*.amazon.evil.com/*`. A privacy product whose pitch is
 * "these are the only hosts it can reach" cannot ship a guard with that hole.
 */
export function isKnownAmazonHost(pattern: string): boolean {
  return matchPatterns().includes(pattern);
}
