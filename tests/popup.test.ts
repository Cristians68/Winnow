// @vitest-environment happy-dom
/**
 * The popup.
 *
 * Its job is to restate the panel's conclusion in one glance, which makes it
 * the easiest place in the product to accidentally overstate one. The engine
 * refuses to invent an adjusted rating it cannot support and refuses to grade a
 * page it could not read; those refusals are only worth anything if the surface
 * the user actually looks at carries them through rather than rendering
 * "null★" or a confident letter over missing data.
 *
 * So these tests are mostly about what the popup must *not* say.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Analysis } from '../src/core/types.js';
import { SETTINGS_KEY, DEFAULT_SETTINGS } from '../src/shared/settings.js';

const DOM = `
  <div class="grade" id="grade">–</div>
  <h1 id="headline">Checking this page…</h1>
  <p id="sub"></p>
  <p class="basis" id="basis" hidden></p>
  <input type="checkbox" id="enabled" checked />
  <a href="#" id="options">Settings</a>
`;

let sendMessage: ReturnType<typeof vi.fn>;
let setStored: ReturnType<typeof vi.fn>;
let openOptionsPage: ReturnType<typeof vi.fn>;

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    asin: 'B000000001',
    grade: 'D',
    trustScore: 42,
    adjustedRating: 3.9,
    displayedRating: 4.6,
    discountedCount: 5,
    concerningSignals: 2,
    sampleSize: 13,
    confidence: 'moderate',
    basis: 'Based on the 13 reviews visible on this page. This is an estimate, not proof.',
    signals: [],
    assessments: [],
    insufficientData: false,
    engineVersion: '0.1.0',
    analysedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Boot the popup against a stubbed extension environment and let it settle. */
async function loadPopup(response: unknown, { throws = false, noTab = false } = {}): Promise<void> {
  document.body.innerHTML = DOM;

  sendMessage = vi.fn(async () => {
    if (throws) throw new Error('Could not establish connection.');
    return response;
  });
  setStored = vi.fn(async () => undefined);
  openOptionsPage = vi.fn();

  (globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: {
      query: vi.fn(async () => (noTab ? [] : [{ id: 7 }])),
      sendMessage,
    },
    runtime: { openOptionsPage },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: DEFAULT_SETTINGS })),
        set: setStored,
      },
    },
  };

  vi.resetModules();
  await import('../src/popup/index.js');
  // The module kicks off async work at import; give the microtask queue a turn.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const text = (id: string) => document.getElementById(id)!.textContent ?? '';
const hidden = (id: string) => (document.getElementById(id) as HTMLElement).hidden;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('popup', () => {
  it('shows the grade, adjusted rating and basis for a normal analysis', async () => {
    await loadPopup({ analysis: analysis() });

    expect(text('grade')).toBe('D');
    expect(text('headline')).toBe('Many reviews look manipulated');
    expect(text('sub')).toContain('3.9★');
    expect(text('sub')).toContain('42/100');
    expect(hidden('basis')).toBe(false);
    expect(text('basis')).toContain('not proof');
  });

  it('refuses to show a grade for a page it could not read', async () => {
    await loadPopup({ analysis: analysis({ insufficientData: true }) });

    expect(text('grade')).toBe('?');
    expect(text('headline')).toBe("Couldn't read this page");
    // The distinction the whole product rests on.
    expect(text('sub')).toContain('Not a verdict about the product');
    expect(text('headline')).not.toMatch(/manipulated|genuine/);
  });

  it('says so plainly when there is too little data for a rating', async () => {
    await loadPopup({ analysis: analysis({ adjustedRating: null }) });

    expect(text('sub')).toBe('Too little trustworthy data to estimate a rating.');
    expect(text('sub')).not.toContain('null');
    expect(text('sub')).not.toContain('NaN');
  });

  it('handles a page with no content script without breaking', async () => {
    await loadPopup(undefined, { throws: true });

    expect(text('grade')).toBe('–');
    expect(text('headline')).toBe('Not an Amazon product page');
    expect(hidden('basis')).toBe(true);
  });

  it('handles a product page that has not been analysed yet', async () => {
    await loadPopup({ analysis: null });

    expect(text('grade')).toBe('–');
    expect(text('headline')).toBe('Nothing analysed yet');
  });

  it('handles there being no active tab', async () => {
    await loadPopup(undefined, { noTab: true });
    expect(text('headline')).toBe('No active tab');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('reflects the stored enabled setting and writes changes back', async () => {
    await loadPopup({ analysis: analysis() });

    const toggle = document.getElementById('enabled') as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setStored).toHaveBeenCalledWith({
      [SETTINGS_KEY]: expect.objectContaining({ enabled: false }),
    });
  });

  it('opens the options page instead of following a dead href', async () => {
    await loadPopup({ analysis: analysis() });

    const link = document.getElementById('options')!;
    const event = new Event('click', { cancelable: true });
    link.dispatchEvent(event);

    expect(openOptionsPage).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('maps every grade to a headline and tone', async () => {
    for (const [grade, expected] of [
      ['A', 'Reviews look genuine'],
      ['B', 'Reviews look mostly genuine'],
      ['C', 'Some reviews look questionable'],
      ['D', 'Many reviews look manipulated'],
      ['F', 'Reviews look heavily manipulated'],
    ] as const) {
      await loadPopup({ analysis: analysis({ grade }) });
      expect(text('headline')).toBe(expected);
      expect(document.getElementById('grade')!.className).toMatch(/good|mixed|bad/);
    }
  });
});
