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
import { mountPanel } from './ui.js';
import type { Analysis, ProductSnapshot } from '../core/types.js';
import type { DeepAugmentation } from '../core/score.js';
import { DEFAULT_SETTINGS, getSettings, SETTINGS_KEY, type Settings } from '../shared/settings.js';
import { buildRequest, toAugmentation, type DeepAnalysisResponse } from '../shared/deep.js';

let currentAnalysis: Analysis | null = null;
let settings: Settings = DEFAULT_SETTINGS;
let lastFingerprint = '';
let scheduled: number | undefined;

/** Cheap signature of the inputs, so we only re-render when something changed. */
function fingerprint(): string {
  const reviews = document.querySelectorAll('[data-hook="review"]').length;
  const rating = document.querySelector('#acrCustomerReviewText')?.textContent ?? '';
  return `${location.pathname}|${reviews}|${rating}`;
}

let currentSnapshot: ProductSnapshot | null = null;
let augmentation: DeepAugmentation | undefined;
let deepState: 'idle' | 'loading' | 'done' | 'error' = 'idle';
let deepError: string | undefined;

function render(): void {
  if (!currentAnalysis || !settings.enabled) return;
  mountPanel(currentAnalysis, {
    expanded: settings.alwaysExpand,
    theme: settings.theme,
    onDeepAnalysis: runDeepAnalysis,
    deepState,
    deepError,
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
  document.getElementById('winnow-root')?.remove();
}

function scheduleRun(): void {
  if (scheduled !== undefined) clearTimeout(scheduled);
  scheduled = window.setTimeout(() => {
    scheduled = undefined;
    const next = fingerprint();
    if (next === lastFingerprint) return;
    lastFingerprint = next;
    try {
      run();
    } catch (error) {
      // A parsing failure must never break the host page.
      console.warn('[winnow] analysis failed', error);
    }
  }, 400);
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
  const observer = new MutationObserver(scheduleRun);
  observer.observe(document.body, { childList: true, subtree: true });

  // Belt-and-braces for history-based navigation between products.
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
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
