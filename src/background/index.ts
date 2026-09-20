/**
 * Service worker.
 *
 * Two jobs: seed default settings, and broker deep-analysis requests.
 *
 * The fetch lives here rather than in the content script so the page context
 * never holds network capability, and so exactly one place in the codebase can
 * talk to the network — easy to audit, easy to keep honest.
 */

import { DEFAULT_SETTINGS, SETTINGS_KEY, getSettings, isDevEndpoint } from '../shared/settings.js';
import { API_ENDPOINT } from '../shared/deep.js';
import { countView, requestAd } from './ads.js';

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
      // A dev override is honoured only when it points at loopback, so this can
      // never become a route for sending page data to an arbitrary host.
      const { devApiEndpoint } = await getSettings();
      const endpoint = isDevEndpoint(devApiEndpoint) ? devApiEndpoint : API_ENDPOINT;

      // No hosted service in this build, and no local one configured. The panel
      // hides the button in that state, so reaching here means something asked
      // for deep analysis anyway — refuse rather than invent a destination.
      if (endpoint === null) {
        sendResponse({ ok: false, error: 'Deep analysis is not configured in this build.' });
        return;
      }

      const response = await fetch(endpoint, {
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

/**
 * Sponsorship slot for Winnow's own surfaces.
 *
 * Registered as its own listener rather than folded into the deep-analysis one
 * so the two never share a code path. Deep analysis sends page data the user
 * explicitly asked to have analysed; ads send none and must keep sending none,
 * and a shared branch is how that distinction erodes.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'winnow:ad-view') {
    void countView(message.viewUrl as string);
    return false;
  }
  if (message?.type !== 'winnow:ad-request') return false;

  void (async () => {
    // Always ok:true — a missing ad is a normal outcome, not an error the UI
    // should distinguish or report. The slot simply stays empty.
    sendResponse({ ok: true, creative: await requestAd(message.slot) });
  })();

  return true; // keep the message channel open for the async reply
});
