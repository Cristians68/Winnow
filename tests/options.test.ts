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
import { DISAGREEMENTS_KEY } from '../src/shared/feedback.js';

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
  <p class="help" id="feedbackCount"></p>
  <button type="button" id="feedbackExport">Export as JSON</button>
  <button type="button" id="feedbackClear">Delete all of it</button>
  <p class="help" id="feedbackStatus"></p>
`;

let setStored: ReturnType<typeof vi.fn>;
let requestPermission: ReturnType<typeof vi.fn>;
let storageArea: Record<string, unknown>;
let removed: string[];

async function loadOptions(
  settings: Partial<Settings> = {},
  { permissionGranted = true, permissionThrows = false, disagreements = undefined as unknown[] | undefined } = {},
): Promise<void> {
  document.body.innerHTML = DOM;

  setStored = vi.fn(async () => undefined);
  requestPermission = vi.fn(async () => {
    if (permissionThrows) throw new Error('user gesture required');
    return permissionGranted;
  });

  storageArea = {
    [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, ...settings },
    [DISAGREEMENTS_KEY]: disagreements,
  };
  removed = [];

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storageArea[key] })),
        set: setStored,
        remove: vi.fn(async (key: string) => {
          removed.push(key);
          delete storageArea[key];
        }),
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

/**
 * The feedback log controls.
 *
 * The load-bearing assertion is the absence of a send button. Everything else
 * here is convenience; that one is the privacy promise expressed as a test.
 */
describe('grade feedback controls', () => {
  const record = (asinHash: string) => ({
    asinHash,
    direction: 'too-harsh',
    grade: 'D',
    trustScore: 41,
    sampleSize: 9,
    sampleSource: 'featured',
    discountedCount: 4,
    signals: [{ id: 'verified', status: 'fail', decisive: true, trustScoreDelta: -18 }],
    engineVersion: '0.1.0',
    recordedOn: '2026-07-28',
  });

  it('says so plainly when nothing has been recorded', async () => {
    await loadOptions();
    expect(document.getElementById('feedbackCount')!.textContent).toMatch(/Nothing recorded/);
  });

  it('disables both controls when there is nothing to act on', async () => {
    await loadOptions();
    expect((document.getElementById('feedbackExport') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('feedbackClear') as HTMLButtonElement).disabled).toBe(true);
  });

  it('counts stored records, with the singular right', async () => {
    await loadOptions({}, { disagreements: [record('aaa')] });
    expect(document.getElementById('feedbackCount')!.textContent).toBe(
      '1 grade recorded on this device.',
    );

    await loadOptions({}, { disagreements: [record('aaa'), record('bbb')] });
    expect(document.getElementById('feedbackCount')!.textContent).toBe(
      '2 grades recorded on this device.',
    );
  });

  it('deletes the log and updates the count', async () => {
    await loadOptions({}, { disagreements: [record('aaa')] });
    (document.getElementById('feedbackClear') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removed).toContain(DISAGREEMENTS_KEY);
    expect(document.getElementById('feedbackCount')!.textContent).toMatch(/Nothing recorded/);
    expect(document.getElementById('feedbackStatus')!.textContent).toBe('Deleted.');
  });

  it('offers no way to transmit the log', async () => {
    await loadOptions({}, { disagreements: [record('aaa')] });

    const labels = [...document.querySelectorAll('button')].map((b) => b.textContent ?? '');
    for (const label of labels) {
      expect(label).not.toMatch(/send|submit|upload|share|report/i);
    }
  });
});
