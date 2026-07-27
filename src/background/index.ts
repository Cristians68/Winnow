/**
 * Service worker.
 *
 * Intentionally almost empty. All scoring happens in the content script, on the
 * user's machine, so there is no work to centralise here yet. When the paid
 * server tier lands, this is where per-ASIN requests will be brokered — and it
 * will still never see session cookies or browsing history.
 */

import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../shared/settings.js';

chrome.runtime.onInstalled.addListener(async (details) => {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  }

  if (details.reason === 'install') {
    console.info('[winnow] installed — analysis runs locally; nothing leaves this browser.');
  }
});
