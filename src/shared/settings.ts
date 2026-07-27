/** User settings, persisted in chrome.storage.local. Deliberately tiny. */

export interface Settings {
  /** Master switch for the on-page panel. */
  enabled: boolean;
  /** Expand the signal breakdown automatically instead of collapsing it. */
  alwaysExpand: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  alwaysExpand: false,
};

const KEY = 'winnow:settings';

export async function getSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.local.get(KEY);
    return { ...DEFAULT_SETTINGS, ...(stored[KEY] as Partial<Settings> | undefined) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
