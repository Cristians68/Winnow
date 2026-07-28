// @vitest-environment happy-dom
/**
 * The options page.
 *
 * The developer-endpoint field is the reason this file exists. It is the only
 * user-writable value in the product that determines where data is sent, which
 * makes it the one setting that could turn a privacy tool into an exfiltration
 * route. The service worker refuses non-loopback endpoints at request time
 * (tests/background.test.ts); this covers the other half — the field must
 * refuse to *store* one, and must not save an endpoint whose host permission
 * the user declined.
 *
 * Two independent refusals, because either one alone is a single point of
 * failure.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, type Settings } from '../src/shared/settings.js';

const DOM = `
  <input type="checkbox" id="enabled" />
  <input type="checkbox" id="alwaysExpand" />
  <select id="theme">
    <option value="system">System</option>
    <option value="light">Light</option>
    <option value="dark">Dark</option>
  </select>
  <span class="saved" id="saved">Saved</span>
  <input type="text" id="devApiEndpoint" />
  <p class="help" id="devStatus"></p>
`;

let setStored: ReturnType<typeof vi.fn>;
let requestPermission: ReturnType<typeof vi.fn>;

async function loadOptions(
  settings: Partial<Settings> = {},
  { permissionGranted = true, permissionThrows = false } = {},
): Promise<void> {
  document.body.innerHTML = DOM;

  setStored = vi.fn(async () => undefined);
  requestPermission = vi.fn(async () => {
    if (permissionThrows) throw new Error('user gesture required');
    return permissionGranted;
  });

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: { ...DEFAULT_SETTINGS, ...settings } })),
        set: setStored,
      },
    },
    permissions: { request: requestPermission },
  };

  vi.resetModules();
  await import('../src/options/index.js');
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Type into the endpoint field and fire the change the module listens for. */
async function enterEndpoint(value: string): Promise<void> {
  const input = document.getElementById('devApiEndpoint') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('change'));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const status = () => document.getElementById('devStatus')!.textContent ?? '';

/** The settings object the module last wrote, if any. */
function lastSaved(): Partial<Settings> | undefined {
  const call = setStored.mock.calls.at(-1);
  return call ? (call[0] as Record<string, Settings>)[SETTINGS_KEY] : undefined;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('developer endpoint field', () => {
  it('refuses a non-loopback address and does not store it', async () => {
    await loadOptions();
    await enterEndpoint('https://evil.example.com/collect');

    expect(status()).toMatch(/Rejected/);
    expect(setStored).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it.each([
    'http://example.com/v1/analyse',
    'https://127.0.0.1.evil.com/v1/analyse',
    'ftp://localhost/v1/analyse',
    'javascript:alert(1)',
    'not a url at all',
  ])('refuses %s', async (value) => {
    await loadOptions();
    await enterEndpoint(value);

    expect(status()).toMatch(/Rejected/);
    expect(setStored).not.toHaveBeenCalled();
  });

  it.each(['http://localhost:8787/v1/analyse', 'http://127.0.0.1:8787/v1/analyse'])(
    'accepts %s once the host permission is granted',
    async (value) => {
      await loadOptions();
      await enterEndpoint(value);

      expect(requestPermission).toHaveBeenCalledWith({ origins: [new URL(value).origin + '/*'] });
      expect(lastSaved()).toMatchObject({ devApiEndpoint: value });
      expect(status()).toBe('Using the local server.');
    },
  );

  it('does not store the endpoint when the user declines the permission', async () => {
    await loadOptions({}, { permissionGranted: false });
    await enterEndpoint('http://localhost:8787/v1/analyse');

    expect(setStored).not.toHaveBeenCalled();
    expect(status()).toMatch(/declined/);
  });

  it('treats a thrown permission request as a refusal rather than crashing', async () => {
    await loadOptions({}, { permissionThrows: true });
    await enterEndpoint('http://localhost:8787/v1/analyse');

    expect(setStored).not.toHaveBeenCalled();
    expect(status()).toMatch(/declined/);
  });

  it('clears back to the live server on an empty value', async () => {
    await loadOptions({ devApiEndpoint: 'http://localhost:8787/v1/analyse' });
    await enterEndpoint('   ');

    expect(lastSaved()).toMatchObject({ devApiEndpoint: '' });
    expect(status()).toBe('Using the live server.');
  });

  it('shows the stored endpoint on load', async () => {
    await loadOptions({ devApiEndpoint: 'http://localhost:8787/v1/analyse' });

    expect((document.getElementById('devApiEndpoint') as HTMLInputElement).value).toBe(
      'http://localhost:8787/v1/analyse',
    );
    expect(status()).toBe('Using the local server.');
  });
});

describe('ordinary settings', () => {
  it('reflects stored values on load', async () => {
    await loadOptions({ enabled: false, alwaysExpand: true, theme: 'dark' });

    expect((document.getElementById('enabled') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('alwaysExpand') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('theme') as HTMLSelectElement).value).toBe('dark');
  });

  it.each(['enabled', 'alwaysExpand'] as const)('persists the %s checkbox', async (id) => {
    await loadOptions({ [id]: false });

    const box = document.getElementById(id) as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lastSaved()).toMatchObject({ [id]: true });
  });

  it('persists a theme change and confirms it visibly', async () => {
    await loadOptions();

    const select = document.getElementById('theme') as HTMLSelectElement;
    select.value = 'light';
    select.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lastSaved()).toMatchObject({ theme: 'light' });
    expect(document.getElementById('saved')!.classList.contains('show')).toBe(true);
  });

  it('ignores a theme value that is not one of the three', async () => {
    await loadOptions();

    const select = document.getElementById('theme') as HTMLSelectElement;
    // Bypass the select's own validation the way a tampered page could.
    Object.defineProperty(select, 'value', { value: 'neon', configurable: true });
    select.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setStored).not.toHaveBeenCalled();
  });
});
