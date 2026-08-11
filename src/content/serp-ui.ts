/**
 * Badges on search result cards.
 *
 * These are the first Winnow UI that is NOT inside a shadow root. The panel can
 * be isolated because it is a block Winnow owns; a badge has to sit inside
 * Amazon's grid and flow with it, and a shadow host there fights the layout.
 *
 * The cost is that Amazon's stylesheet can reach these elements. So every
 * declaration below is defensive: explicit values for anything inherited,
 * `all: initial` on the badge root, and a class prefix nothing else will match.
 *
 * The two states are deliberately not a spectrum. "Graded" carries a letter
 * Winnow actually computed on that product's own page. "Not checked" carries no
 * colour that reads as either safe or suspect, because Winnow knows nothing
 * about that product and a neutral-looking dot is the honest rendering of
 * knowing nothing.
 */

import type { SearchCard } from './serp-parse.js';
import type { CachedGrade } from '../shared/cache.js';

export const BADGE_CLASS = 'winnow-serp-badge';
const STYLE_ID = 'winnow-serp-style';

interface Swatch { fg: string; bg: string }

/** Used when a stored grade is not one we know. Neither reassuring nor alarming. */
const UNKNOWN_GRADE: Swatch = { fg: '#5b4300', bg: '#fdf0cd' };

const GRADE_COLOURS: Record<string, Swatch> = {
  A: { fg: '#0b3d20', bg: '#d7f0e0' },
  B: { fg: '#0b3d20', bg: '#e4f4ea' },
  C: { fg: '#5b4300', bg: '#fdf0cd' },
  D: { fg: '#6b2409', bg: '#fde2d6' },
  F: { fg: '#6b1010', bg: '#fbd9d9' },
};

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  // Contrast pairs above are all >= 7:1, comfortably past WCAG 1.4.3 AA, because
  // these sit on a page whose background we do not control.
  style.textContent = `
    .${BADGE_CLASS} {
      all: initial;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin: 4px 0 0;
      padding: 2px 7px;
      border-radius: 10px;
      border: 1px solid #858e9c;
      font: 600 11px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      letter-spacing: 0.02em;
      white-space: nowrap;
      cursor: default;
    }
    .${BADGE_CLASS}[data-winnow-state="unchecked"] {
      color: #4a5260;
      background: #eef0f3;
      font-weight: 500;
    }
  `;
  (doc.head ?? doc.documentElement).appendChild(style);
}

function label(entry: CachedGrade | undefined): { text: string; aria: string } {
  if (!entry) {
    return {
      text: 'Winnow · not checked',
      aria: 'Winnow has not checked this listing. Open it to check its reviews.',
    };
  }
  return {
    text: `Winnow · ${entry.grade}`,
    aria: `Winnow graded this listing's reviews ${entry.grade} on ${entry.date}.`,
  };
}

/**
 * Insert or update a badge on each card.
 *
 * Idempotent: Amazon re-renders the grid on every filter change, so this runs
 * repeatedly against cards that may already carry a badge.
 */
export function renderBadges(cards: SearchCard[], cache: Map<string, CachedGrade>): void {
  const first = cards[0];
  if (!first) return;
  const doc = first.element.ownerDocument;
  ensureStyle(doc);

  for (const card of cards) {
    const entry = cache.get(card.asin);
    const { text, aria } = label(entry);

    let badge = card.element.querySelector<HTMLElement>(`.${BADGE_CLASS}`);
    if (!badge) {
      badge = doc.createElement('span');
      badge.className = BADGE_CLASS;
      // role=note rather than status: this is not a live region, and announcing
      // every card on every grid re-render would be hostile to screen readers.
      badge.setAttribute('role', 'note');
      card.anchor.appendChild(badge);
    }

    badge.dataset.winnowAsin = card.asin;
    badge.dataset.winnowState = entry ? 'graded' : 'unchecked';
    badge.textContent = text;
    badge.setAttribute('aria-label', aria);
    badge.title = aria;

    if (entry) {
      const colour = GRADE_COLOURS[entry.grade] ?? UNKNOWN_GRADE;
      badge.style.color = colour.fg;
      badge.style.background = colour.bg;
    } else {
      // The element outlives the grade. A product that has fallen out of the
      // cache — cleared from Options, expired, or invalidated by an engine
      // bump — would otherwise keep the colour it was painted as a D while
      // reading "not checked", which is a grade by another means.
      badge.style.removeProperty('color');
      badge.style.removeProperty('background');
    }
  }
}
