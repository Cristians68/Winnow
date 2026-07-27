/**
 * Service worker.
 *
 * Two jobs: seed default settings, and broker deep-analysis requests.
 *
 * The fetch lives here rather than in the content script so the page context
 * never holds network capability, and so exactly one place in the codebase can
 * talk to the network — easy to audit, easy to keep honest.
 */

import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../shared/settings.js';
import { API_ENDPOINT } from '../shared/deep.js';

const REQUEST_TIMEOUT_MS = 12_000;

chrome.runtime.onInstalled.addListener(async (details) => {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  }

  if (details.reason === 'install') {
    console.info('[winnow] installed — grades are computed locally; nothing is sent unless you ask for deep analysis.');
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'winnow:deep-analyse') return false;

  void (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message.payload),
        signal: controller.signal,
        // No cookies, no cached credentials, no ambient authority.
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });

      if (!response.ok) {
        sendResponse({ ok: false, error: `Deep analysis unavailable (${response.status}).` });
        return;
      }
      sendResponse({ ok: true, data: await response.json() });
    } catch (error) {
      sendResponse({
        ok: false,
        error:
          error instanceof Error && error.name === 'AbortError'
            ? 'Deep analysis timed out.'
            : 'Could not reach the deep-analysis service.',
      });
    } finally {
      clearTimeout(timeout);
    }
  })();

  return true; // keep the message channel open for the async reply
});
