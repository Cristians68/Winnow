// @vitest-environment happy-dom
/**
 * The panel's life on a page that will not hold still.
 *
 * Amazon product pages load their review module after first paint, swap it on
 * variant selection, and mutate continuously in the background as carousels
 * advance and ad slots fill. Three defects lived in that gap, and all three are
 * invisible to every other suite here because every other suite hands the
 * parser a page that is already finished:
 *
 *  1. The change detector watched one selector out of the five the parser
 *     tries, so on any layout served through a different one it never noticed
 *     reviews arriving.
 *  2. The settle timer was a plain trailing debounce, so a page that never
 *     stops mutating could defer the analysis forever.
 *  3. Re-rendering rebuilt the panel from scratch, discarding whatever the user
 *     had open, said, or had keyboard focus on.
 *
 * None of the three throws. They are all failures of *nothing happening*, which
 * is why they need tests that watch time pass rather than tests that check a
 * return value.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { analyse } from '../src/core/score.js';
import { mountPanel, PANEL_HOST_ID } from '../src/content/ui.js';
import type { ProductSnapshot, Review } from '../src/core/types.js';

type HappyWindow = Window & { happyDOM?: { setURL?: (url: string) => void } };

const HEADER = `
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
  <div id="customerReviews"></div>
`;

/**
 * Reviews in the markup shape the parser reaches through its *last* fallback:
 * no `data-hook="review"` anywhere, an `id` prefix instead, and the body in
 * plain paragraphs. This is the rename-proof path the parser deliberately
 * keeps — and precisely the one the old change detector could not see.
 */
const BODIES = [
  'The sound is clean at low volume and the case survived a drop onto tile.',
  'Battery lasted a full working week for me, charging only on Fridays.',
  'Fit is snug; I had to swap to the smaller tips before they stayed put.',
  'Pairing with an older laptop took two attempts but has been stable since.',
  'The carry pouch is thin, though the headphones themselves feel solid.',
  'Noticeably better than the pair I returned last month for rattling.',
];

function lateReviewMarkup(): string {
  return BODIES.map(
    (body, i) => `
    <div id="customer_review-R${i}">
      <i class="a-star-5"><span class="a-icon-alt">5.0 out of 5 stars</span></i>
      <span class="a-color-state a-text-bold">Verified Purchase</span>
      <p>${body}</p>
    </div>`,
  ).join('');
}

function panel(): ShadowRoot | null {
  return document.getElementById(PANEL_HOST_ID)?.shadowRoot ?? null;
}

const panelText = () => panel()?.textContent ?? '';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadContentScript(url = 'https://www.amazon.com/dp/B08N5WRWNW'): Promise<void> {
  (window as HappyWindow).happyDOM?.setURL?.(url);
  document.documentElement.setAttribute('lang', 'en-US');
  document.body.innerHTML = HEADER;

  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn() } },
    storage: {
      local: { get: vi.fn(async (key: string) => ({ [key]: {} })), set: vi.fn(async () => undefined) },
      onChanged: { addListener: vi.fn() },
    },
  };

  vi.resetModules();
  await import('../src/content/index.js');
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reviews that arrive after the panel has already mounted', () => {
  /**
   * The detector bug, end to end.
   *
   * Pre-fix the signature was `pathname | count of [data-hook="review"] |
   * #acrCustomerReviewText`. On this markup the count is zero before and after
   * the reviews land, and the rating text never changes, so the signature is
   * constant and `run()` was skipped for the life of the page. The user was
   * left looking at the refusal state on a page that had loaded fine.
   */
  it('notices reviews in a markup the old change detector could not see', async () => {
    await loadContentScript();
    await wait(700);

    expect(panel(), 'panel should mount even before the reviews load').not.toBeNull();
    // Before the reviews land the histogram is all there is, and the panel must
    // say so rather than describing reviews it has not seen.
    expect(panelText()).toMatch(/rating breakdown/i);
    expect(panelText()).not.toMatch(/Reviews look genuine/i);

    // Amazon fills the review module in.
    document.getElementById('customerReviews')!.innerHTML = lateReviewMarkup();
    await wait(900);

    expect(panelText()).toMatch(/Reviews look (genuine|mostly genuine)/i);
    expect(panelText()).toMatch(/6 visible reviews|6 reviews visible/i);
  }, 10_000);
});

describe('a grade resting on the rating breakdown alone', () => {
  /**
   * Found by the test above rather than looked for, which is why it is worth
   * writing down. A product page renders its histogram well before the review
   * module, and on a listing with tens of thousands of ratings that histogram
   * carries enough weight to produce a grade with no reviews behind it.
   *
   * The grade is defensible. The words around it were not: "Reviews look
   * genuine", "Nothing flagged across 0 visible reviews", an "Adjusted rating"
   * identical to Amazon's own, and "Every check came back clear" — all sitting
   * directly above six rows reading "No reviews were readable on this page".
   * Reporting an inspection of nothing as a clean inspection is the exact
   * failure this product exists to name.
   */
  const ratingsOnly = () => {
    const base = snapshot(0);
    return analyse({ ...base, totalRatings: 12_345 });
  };

  it('grades from the histogram but never claims the reviews were checked', () => {
    const text = renderToText(ratingsOnly());

    expect(text).toMatch(/Rating breakdown looks normal/);
    expect(text).not.toMatch(/Reviews look genuine/);
    expect(text).not.toMatch(/Nothing flagged across 0/);
    expect(text).not.toMatch(/Every check came back clear/);
  });

  it('refuses to print an adjusted rating it did not adjust', () => {
    const analysis = ratingsOnly();
    expect(analysis.adjustedRating).toBeNull();
    expect(renderToText(analysis)).not.toMatch(/Adjusted rating\s*4\.4/);
  });

  it('says what the grade actually rests on', () => {
    const analysis = ratingsOnly();
    expect(analysis.basis).toMatch(/only on the rating breakdown/i);
    expect(analysis.basis).toMatch(/no individual reviews were readable/i);
    expect(analysis.basis).not.toMatch(/the 0 reviews/);
  });

  it('still speaks normally once reviews are readable', () => {
    const text = renderToText(analyse(snapshot(6)));
    expect(text).toMatch(/Reviews look (genuine|mostly genuine)/);
    expect(text).not.toMatch(/Rating breakdown looks/);
  });
});

function renderToText(analysis: ReturnType<typeof analyse>): string {
  document.body.innerHTML = '<div id="centerCol"></div>';
  mountPanel(analysis, {});
  return panelText();
}

describe('a page that never stops mutating', () => {
  /**
   * The starvation bug.
   *
   * Every mutation reset a 400ms trailing timer, so a page mutating faster than
   * that deferred the analysis indefinitely — no error, no panel, nothing to
   * debug. The deadline added in scheduleRun caps the total wait, so the run
   * happens even while the churn continues.
   */
  it('still analyses the page while background churn continues', async () => {
    await loadContentScript();

    const noise = document.createElement('div');
    document.body.append(noise);
    // Faster than the 400ms settle window: enough to reset it every time.
    const churn = setInterval(() => {
      noise.append(document.createElement('span'));
    }, 120);

    document.getElementById('customerReviews')!.innerHTML = lateReviewMarkup();

    try {
      await wait(2_600);
      expect(panel(), 'the panel must appear despite continuous mutations').not.toBeNull();
      expect(panelText()).not.toMatch(/Couldn't read this page/i);
    } finally {
      clearInterval(churn);
    }
  }, 15_000);
});

// --------------------------------------------------------------------------

function review(i: number): Review {
  return {
    id: `r${i}`,
    rating: 5,
    verified: true,
    text: BODIES[i % BODIES.length]!,
    helpfulVotes: 3,
  };
}

function snapshot(count: number): ProductSnapshot {
  return {
    asin: 'B000000001',
    displayedRating: 4.4,
    totalRatings: 900,
    histogram: { 5: 60, 4: 18, 3: 9, 2: 5, 1: 8 },
    language: 'en',
    reviews: Array.from({ length: count }, (_, i) => review(i)),
    capturedAt: new Date().toISOString(),
  };
}

describe('what survives the panel being rebuilt', () => {
  const options = { onFeedback: () => {}, expanded: false };

  function toggle(): HTMLButtonElement {
    return panel()!.querySelector<HTMLButtonElement>('[data-winnow-key="toggle"]')!;
  }

  function breakdownOpen(): boolean {
    return !panel()!.getElementById('winnow-signals')!.hidden;
  }

  beforeEach(() => {
    document.body.innerHTML = '<div id="centerCol"></div>';
  });

  it('keeps the breakdown open when the page changes underneath it', () => {
    mountPanel(analyse(snapshot(6)), options);
    expect(breakdownOpen()).toBe(false);

    toggle().click();
    expect(breakdownOpen()).toBe(true);

    // One more review loads and the panel is rebuilt.
    mountPanel(analyse(snapshot(7)), options);
    expect(breakdownOpen(), 'a breakdown the user opened must stay open').toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps a collapsed breakdown collapsed', () => {
    mountPanel(analyse(snapshot(6)), options);
    mountPanel(analyse(snapshot(7)), options);
    expect(breakdownOpen()).toBe(false);
  });

  /**
   * The accessibility half. Losing focus on rebuild drops a keyboard user back
   * at the top of a very long page with no announcement of why.
   */
  it('returns keyboard focus to the control it was on', () => {
    mountPanel(analyse(snapshot(6)), options);
    toggle().focus();
    expect(panel()!.activeElement?.getAttribute('data-winnow-key')).toBe('toggle');

    mountPanel(analyse(snapshot(7)), options);
    expect(panel()!.activeElement?.getAttribute('data-winnow-key')).toBe('toggle');
  });

  it('does not grab focus when the user was not in the panel', () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="elsewhere">Add to cart</button>');
    mountPanel(analyse(snapshot(6)), options);

    const elsewhere = document.getElementById('elsewhere') as HTMLButtonElement;
    elsewhere.focus();

    mountPanel(analyse(snapshot(7)), options);
    expect(document.activeElement).toBe(elsewhere);
  });

  it('remembers that the user already said the grade was wrong', () => {
    const recorded: string[] = [];
    mountPanel(analyse(snapshot(6)), { onFeedback: (d) => recorded.push(d) });

    const harsh = panel()!.querySelector<HTMLButtonElement>('[data-winnow-key="feedback:too-harsh"]')!;
    harsh.click();
    expect(recorded).toEqual(['too-harsh']);

    mountPanel(analyse(snapshot(7)), { onFeedback: (d) => recorded.push(d) });

    const after = panel()!.querySelector<HTMLButtonElement>('[data-winnow-key="feedback:too-harsh"]')!;
    expect(after.disabled, 'the buttons must not re-arm themselves').toBe(true);
    expect(panelText()).toMatch(/Saved on this device only/);
    expect(recorded, 'nothing may be recorded twice by a re-render').toEqual(['too-harsh']);
  });
});
