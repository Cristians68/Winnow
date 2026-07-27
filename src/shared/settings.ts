/** User settings, persisted in chrome.storage.local. Deliberately tiny. */

export interface Settings {
  /** Master switch for the on-page panel. */
  enabled: boolean;
  /** Expand the signal breakdown automatically instead of collapsing it. */
  alwaysExpand: boolean;
  /**
   * Development only: send deep-analysis requests to a local server instead of
   * production. Empty means production.
   *
   * Restricted to loopback by isDevEndpoint() so this can never be turned into
   * a way to exfiltrate page data to an arbitrary host — a settings value that
   * accepted any URL would be a data-exfiltration primitive sitting inside a
   * privacy product.
   */
  devApiEndpoint: string;
  /**
   * Panel appearance. 'system' follows the OS setting; the other two override
   * it, because plenty of people run a light OS with a dark Amazon extension or
   * the reverse, and a tool that sits inside someone else's page should not
   * dictate that.
   */
  theme: Theme;
}

export type Theme = 'system' | 'light' | 'dark';

export const THEMES: Theme[] = ['system', 'light', 'dark'];

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  alwaysExpand: false,
  devApiEndpoint: '',
  theme: 'system',
};

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as string[]).includes(value);
}

/** Only loopback origins are accepted as a dev endpoint override. */
export function isDevEndpoint(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

export const SETTINGS_KEY = 'winnow:settings';

export async function getSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<Settings> | undefined) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
