/**
 * Search results content script.
 *
 * Reads nothing from the network and computes no grades. It matches cards
 * against grades already earned on product pages and marks the rest unchecked.
 *
 * The lifecycle discipline here is copied deliberately from
 * src/content/index.ts, including the deadline. Amazon's search grid mutates
 * continuously, and a plain trailing debounce on a page that never stops
 * changing defers its work forever.
 */

import { findSearchCards, isSearchPage } from './serp-parse.js';
import { renderBadges, BADGE_CLASS } from './serp-ui.js';
import { readCache } from '../shared/cache.js';
import { DEFAULT_SETTINGS, getSettings, SETTINGS_KEY, type Settings } from '../shared/settings.js';

const SETTLE_MS = 250;
const DEADLINE_MS = 2000;

let settings: Settings = DEFAULT_SETTINGS;
let scheduled: number | undefined;
let deadline: number | undefined;

function removeBadges(): void {
  for (const badge of document.querySelectorAll(`.${BADGE_CLASS}`)) badge.remove();
}

async function paint(): Promise<void> {
  // Switching the extension off has to take effect on the page already open,
  // not only on the next one. The product panel unmounts itself for the same
  // reason; badges left behind would be the same broken promise.
  if (!settings.enabled) {
    removeBadges();
    return;
  }
  if (!isSearchPage()) return;
  const cards = findSearchCards();
  if (cards.length === 0) return;
  renderBadges(cards, await readCache());
}

function schedule(): void {
  if (scheduled !== undefined) clearTimeout(scheduled);
  scheduled = setTimeout(run, SETTLE_MS) as unknown as number;
  // Without this ceiling a grid that never settles is a grid we never badge.
  if (deadline === undefined) {
    deadline = setTimeout(run, DEADLINE_MS) as unknown as number;
  }
}

function run(): void {
  if (scheduled !== undefined) clearTimeout(scheduled);
  if (deadline !== undefined) clearTimeout(deadline);
  scheduled = undefined;
  deadline = undefined;
  void paint();
}

async function start(): Promise<void> {
  settings = await getSettings();
  if (!isSearchPage()) return;

  run();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    settings = { ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue as Partial<Settings>) };
    run();
  });
}

void start();
