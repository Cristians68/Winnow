/**
 * Content script entry point.
 *
 * Responsibilities, in order: decide whether this page is worth looking at,
 * read what Amazon already rendered, score it locally, and mount the panel.
 *
 * It makes no network requests of any kind. Amazon lazy-loads the review
 * section, so we re-check as the page settles, but only ever by re-reading the
 * DOM that the browser already has.
 */

import { buildSnapshot, isProductPage } from './parse.js';
import { analyse } from '../core/score.js';
import { mountPanel, PANEL_HOST_ID } from './ui.js';
import type { Analysis, ProductSnapshot } from '../core/types.js';
import type { DeepAugmentation } from '../core/score.js';
import { DEFAULT_SETTINGS, getSettings, isDevEndpoint, SETTINGS_KEY, type Settings } from '../shared/settings.js';
import { API_ENDPOINT, buildRequest, toAugmentation, type DeepAnalysisResponse } from '../shared/deep.js';
import { recordDisagreement, type DisagreementDirection } from '../shared/feedback.js';

let currentAnalysis: Analysis | null = null;
let settings: Settings = DEFAULT_SETTINGS;
let lastFingerprint = '';
let scheduled: number | undefined;
let deadline: number | undefined;

/**
 * Signature of the analysed inputs, so we only re-render when something changed.
 *
 * This is taken from the finished snapshot rather than from a couple of hand
 * picked selectors, and that is the point. The previous version counted
 * `[data-hook="review"]` nodes — one entry in a five-deep fallback chain the
 * parser tries. On any layout served through a different entry in that chain
 * the count is permanently zero, the signature never changes as reviews load in,
 * and the panel freezes on whatever it saw at first paint: usually the
 * "couldn't read this page" state, on a page it could read perfectly well a
 * second later.
 *
 * A change detector that watches different markup from the parser it guards is
 * a detector that will go blind without anything failing. Deriving it from the
 * parser's own output means it cannot drift out of step by construction.
 */
function fingerprintOf(snapshot: ProductSnapshot): string {
  const reviews = snapshot.reviews
    .map((r) => `${r.id}:${r.rating}:${r.verified ? 1 : 0}:${(r.text ?? '').length}`)
    .join(',');
  return [
    location.pathname + location.search,
    snapshot.asin,
    snapshot.displayedRating ?? '',
    snapshot.totalRatings ?? '',
    JSON.stringify(snapshot.histogram ?? null),
    snapshot.reviews.length,
    reviews,
  ].join('|');
}

let currentSnapshot: ProductSnapshot | null = null;
let augmentation: DeepAugmentation | undefined;
let deepState: 'idle' | 'loading' | 'done' | 'error' = 'idle';
let deepError: string | undefined;

/**
 * Deep analysis is offered only when there is somewhere to send it: a hosted
 * endpoint, or a loopback one the user configured in Options. Otherwise the
 * button is hidden rather than shown and left to fail, since a control that
 * cannot work is worse than no control.
 */
function deepAnalysisAvailable(): boolean {
  return API_ENDPOINT !== null || isDevEndpoint(settings.devApiEndpoint);
}

/**
 * Store a rejected grade locally. Deliberately fire-and-forget: the panel must
 * not wait on storage, and a failed write is not worth interrupting anyone over.
 */
function handleFeedback(direction: DisagreementDirection): void {
  if (!currentAnalysis) return;
  void recordDisagreement(
    currentAnalysis,
    direction,
    currentSnapshot?.sampleSource ?? 'featured',
  );
}

function render(): void {
  if (!currentAnalysis || !settings.enabled) return;
  mountPanel(currentAnalysis, {
    expanded: settings.alwaysExpand,
    theme: settings.theme,
    ...(deepAnalysisAvailable() ? { onDeepAnalysis: runDeepAnalysis } : {}),
    deepState,
    deepError,
    onFeedback: handleFeedback,
  });
}

/**
 * Deep analysis is the only code path in the extension that touches a network,
 * and it runs solely from an explicit click. The request describes a public
 * listing, never the person viewing it.
 */
async function runDeepAnalysis(): Promise<void> {
  if (!currentSnapshot) return;
  deepState = 'loading';

  try {
    const payload = await buildRequest(currentSnapshot);
    const response = await chrome.runtime.sendMessage({ type: 'winnow:deep-analyse', payload });

    if (!response?.ok) {
      deepState = 'error';
      deepError = response?.error ?? 'Deep analysis failed.';
    } else {
      augmentation = toAugmentation(response.data as DeepAnalysisResponse);
      currentAnalysis = analyse(currentSnapshot, augmentation);
      deepState = 'done';
      deepError = undefined;
    }
  } catch {
    deepState = 'error';
    deepError = 'Deep analysis failed.';
  }

  render();
}

function run(): void {
  if (!isProductPage()) return;

  const snapshot = buildSnapshot();
  if (!snapshot) return;

  // Nothing we analyse has changed, so re-rendering would only throw away the
  // panel the user is currently reading. See mountPanel for what that costs.
  const next = fingerprintOf(snapshot);
  if (next === lastFingerprint) return;
  lastFingerprint = next;

  // A different product invalidates any deep result we were showing.
  if (currentSnapshot && currentSnapshot.asin !== snapshot.asin) {
    augmentation = undefined;
    deepState = 'idle';
    deepError = undefined;
  }

  currentSnapshot = snapshot;
  currentAnalysis = analyse(snapshot, augmentation);
  render();
}

function removePanel(): void {
  document.getElementById(PANEL_HOST_ID)?.remove();
}

/** Wait this long after the last mutation before re-reading the page. */
const SETTLE_MS = 400;

/**
 * …but never wait longer than this in total.
 *
 * A plain trailing debounce assumes mutations arrive in bursts with gaps
 * between them. Amazon product pages do not behave that way: carousels
 * advance, ad slots fill, images swap in and recommendation strips rebuild, all
 * on their own timers and often continuously. Every one of those resets the
 * timer, so on a busy page the analysis could be deferred indefinitely and the
 * panel would simply never appear — with no error anywhere, because nothing
 * failed. It just never ran.
 *
 * The deadline turns the debounce into "settle if you can, but run regardless
 * within two seconds", which is the behaviour that was intended all along.
 */
const MAX_WAIT_MS = 2_000;

function scheduleRun(): void {
  const now = Date.now();
  if (deadline === undefined) deadline = now + MAX_WAIT_MS;

  const delay = Math.max(0, Math.min(SETTLE_MS, deadline - now));
  if (scheduled !== undefined) clearTimeout(scheduled);

  scheduled = window.setTimeout(() => {
    scheduled = undefined;
    deadline = undefined;
    try {
      run();
    } catch (error) {
      // A parsing failure must never break the host page.
      console.warn('[winnow] analysis failed', error);
    }
  }, delay);
}

async function start(): Promise<void> {
  settings = await getSettings();

  // React to the popup/options toggles without needing a page reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    settings = { ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue as Partial<Settings>) };
    if (!settings.enabled) {
      removePanel();
    } else {
      render();
    }
  });

  scheduleRun();

  // Amazon injects the review module after first paint and swaps content on
  // in-page navigation, so watch for both.
  //
  // Mounting the panel is itself a mutation of the page, so changes inside our
  // own subtree are ignored. Without that, every render schedules another run
  // that reads the whole page again only to conclude nothing changed — a loop
  // that costs the user's CPU for no result on a page that is already heavy.
  const observer = new MutationObserver((records) => {
    const ours = records.every((record) => {
      const target = record.target as Node | null;
      const element = target instanceof Element ? target : target?.parentElement;
      return Boolean(element?.closest(`#${PANEL_HOST_ID}`));
    });
    if (!ours) scheduleRun();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Belt-and-braces for history-based navigation between products. Amazon uses
  // the History API for some in-page transitions, and `?th=` variant switches
  // change the query string while leaving the path alone, so both are watched.
  window.addEventListener('popstate', scheduleRun);

  let lastUrl = location.pathname + location.search;
  setInterval(() => {
    const url = location.pathname + location.search;
    if (url !== lastUrl) {
      lastUrl = url;
      scheduleRun();
    }
  }, 1000);
}

// The popup asks the active tab for whatever it last computed.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'winnow:get-analysis') {
    sendResponse({ analysis: currentAnalysis, url: location.href });
  }
  return false;
});

void start();
