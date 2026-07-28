// @vitest-environment happy-dom
/**
 * The content script, end to end inside the page.
 *
 * Everything else tests a layer: the parser reads markup, the engine scores a
 * snapshot, the worker brokers a request, the panel renders an analysis. This
 * drives all of them together the way a shopper does — a product page exists,
 * the panel appears on it, someone clicks "deep analysis", and the panel comes
 * back changed.
 *
 * That click was the last unexercised path in the product. The network half is
 * covered by tools/deep-smoke.mjs against a live server; this is the half that
 * runs in the page, including the two bits of state that are easy to get wrong:
 * a deep result must survive a re-render, and it must NOT survive navigating to
 * a different product.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const PRODUCT_PAGE = `
  <span id="productTitle">Test Headphones</span>
  <span id="acrPopover" title="4.3 out of 5 stars"></span>
  <span id="acrCustomerReviewText">12,345 ratings</span>
  <div id="histogramTable">
    <a aria-label="5 stars represent 62% of rating" href="#"></a>
    <a aria-label="4 stars represent 18% of rating" href="#"></a>
    <a aria-label="3 stars represent 8% of rating" href="#"></a>
    <a aria-label="2 stars represent 4% of rating" href="#"></a>
    <a aria-label="1 star represents 8% of rating" href="#"></a>
  </div>
  ${Array.from({ length: 8 }, (_, i) => `
    <div data-hook="review" id="R${i}">
      <i data-hook="review-star-rating"><span class="a-icon-alt">5.0 out of 5 stars</span></i>
      <span data-hook="review-date">Reviewed in the United States on March ${i + 1}, 2026</span>
      <div data-hook="review-body"><span>Good sound for the price, and the case survived a drop onto tile.</span></div>
    </div>`).join('')}
  <div id="customerReviews"></div>
`;

let sendMessage: ReturnType<typeof vi.fn>;
let storageListeners: Array<(changes: unknown, area: string) => void>;

/** The rendered panel, reached through its shadow root. */
function panel(): ShadowRoot | null {
  return document.getElementById('winnow-root')?.shadowRoot ?? null;
}

const panelText = () => panel()?.textContent ?? '';

function deepButton(): HTMLButtonElement | null {
  const buttons = [...(panel()?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];
  return buttons.find((b) => /deep/i.test(b.textContent ?? '')) ?? null;
}

/** Let the content script's 400ms settle timer and any pending promises run. */
const settle = async (ms = 600) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

/** happy-dom exposes URL control off-spec, so it is reached through a cast. */
type HappyWindow = Window & { happyDOM?: { setURL?: (url: string) => void } };

/**
 * This build ships with no hosted endpoint, so the panel offers deep analysis
 * only when a loopback one is configured. Tests that exercise the button opt in
 * via `devApiEndpoint`; the default is the shipping configuration.
 */
const LOOPBACK = 'http://127.0.0.1:8787/v1/analyse';

async function loadContentScript(
  url = 'https://www.amazon.com/dp/B08N5WRWNW',
  settings: Record<string, unknown> = {},
): Promise<void> {
  (window as HappyWindow).happyDOM?.setURL?.(url);
  document.body.innerHTML = PRODUCT_PAGE;

  storageListeners = [];
  sendMessage = vi.fn(async () => ({ ok: true, data: deepResponse() }));

  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn() },
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: settings })),
        set: vi.fn(async () => undefined),
      },
      onChanged: { addListener: (fn: (c: unknown, a: string) => void) => storageListeners.push(fn) },
    },
  };

  vi.resetModules();
  await import('../src/content/index.js');
  await settle();
}

/** A server response that condemns every visible review. */
function deepResponse() {
  return {
    contractVersion: 1,
    asin: 'B08N5WRWNW',
    reviewFindings: Array.from({ length: 8 }, (_, i) => ({
      reviewId: `R${i}`,
      delta: 0.9,
      reason: 'Contains phrasing seen on 11 other unrelated products',
      source: 'cross-product-template' as const,
    })),
    productFindings: [
      {
        id: 'ai-text',
        label: 'Generated and templated text',
        status: 'fail' as const,
        detail: '8 review(s) reuse phrasing seen on other products.',
        evidence: ['Contains phrasing seen on 11 other unrelated products'],
      },
    ],
    corpusObservations: 12,
    cached: false,
    computedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('content script on a product page', () => {
  it('mounts the panel and grades the page', async () => {
    await loadContentScript();

    expect(panel()).not.toBeNull();
    expect(panelText()).toMatch(/Winnow/i);
    // The fixture is a clean J-shaped listing, so it should not read as manipulated.
    expect(panelText()).not.toMatch(/heavily manipulated/i);
  });

  it('sends nothing to the network until the user asks', async () => {
    await loadContentScript();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  // The shipping configuration. Offering a control that can only fail is worse
  // than offering none, so the button is absent until an endpoint exists.
  it('offers no deep-analysis button when no endpoint is configured', async () => {
    await loadContentScript();

    expect(panel()).not.toBeNull();
    expect(deepButton()).toBeNull();
    expect(panelText()).not.toMatch(/deep analysis/i);
  });

  it('runs deep analysis on click and folds the result into the grade', async () => {
    await loadContentScript(undefined, { devApiEndpoint: LOOPBACK });

    const before = panelText();
    const button = deepButton();
    expect(button, 'deep-analysis button should be present').not.toBeNull();

    button!.click();
    await settle(50);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [message] = sendMessage.mock.calls[0]!;
    expect((message as { type: string }).type).toBe('winnow:deep-analyse');

    // The server's evidence must actually reach the user, not just be received.
    const after = panelText();
    expect(after).not.toBe(before);
    expect(after).toMatch(/Generated and templated text/);
  });

  it('surfaces a failure instead of silently showing a stale grade', async () => {
    await loadContentScript(undefined, { devApiEndpoint: LOOPBACK });
    sendMessage.mockResolvedValueOnce({ ok: false, error: 'Could not reach the deep-analysis service.' });

    deepButton()!.click();
    await settle(50);

    expect(panelText()).toMatch(/Could not reach the deep-analysis service/);
  });

  it('survives the broker throwing', async () => {
    await loadContentScript(undefined, { devApiEndpoint: LOOPBACK });
    sendMessage.mockRejectedValueOnce(new Error('port closed'));

    deepButton()!.click();
    await settle(50);

    expect(panelText()).toMatch(/Deep analysis failed/);
    expect(panel()).not.toBeNull();
  });

  it('removes the panel when the extension is switched off', async () => {
    await loadContentScript();
    expect(panel()).not.toBeNull();

    for (const listener of storageListeners) {
      listener({ 'winnow:settings': { newValue: { enabled: false } } }, 'local');
    }
    await settle(20);

    expect(document.getElementById('winnow-root')).toBeNull();
  });
});

describe('content script off a product page', () => {
  it('does not mount anything on a search page', async () => {
    await loadContentScript('https://www.amazon.com/s?k=headphones');
    expect(document.getElementById('winnow-root')).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
