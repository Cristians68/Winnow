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
import type { Analysis } from '../core/types.js';
import { getSettings } from '../shared/settings.js';

let currentAnalysis: Analysis | null = null;
let lastFingerprint = '';
let scheduled: number | undefined;

/** Cheap signature of the inputs, so we only re-render when something changed. */
function fingerprint(): string {
  const reviews = document.querySelectorAll('[data-hook="review"]').length;
  const rating = document.querySelector('#acrCustomerReviewText')?.textContent ?? '';
  return `${location.pathname}|${reviews}|${rating}`;
}

function run(): void {
  if (!isProductPage()) return;

  const snapshot = buildSnapshot();
  if (!snapshot) return;

  currentAnalysis = analyse(snapshot);
  mountPanel(currentAnalysis);
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
  const settings = await getSettings();
  if (!settings.enabled) return;

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
