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
import { headlineFor, mountPanel, PANEL_HOST_ID, renderPanel } from '../src/content/ui.js';
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
  // Beyond the six used for the late-loading markup. Every body has to be
  // genuinely distinct: reviews sharing text trip the duplicate-text check, and
  // a fixture meant to represent a clean listing that quietly discounts most of
  // itself measures the opposite of what it claims to.
  'Charging case lid feels loose after a couple of months of daily opening.',
  'Call quality outdoors is the weak point; wind gets picked up badly.',
  'Went through three brands before this and it is the first that stayed put.',
  'Firmware update in June fixed the stutter I had on the left side.',
  'Bass is heavier than I expected, which suits podcasts less than music.',
  'Case scuffs easily in a bag but the finish on the buds themselves holds up.',
  'Range is fine across one room, drops out if I leave my phone upstairs.',
];

/** Only the first six appear in the late-loading markup, so that count is stable. */
const LATE_BODIES = BODIES.slice(0, 6);

function lateReviewMarkup(): string {
  return LATE_BODIES.map(
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

/**
 * Wording and density defects seen on a live listing, 2026-08-01.
 *
 * A camera lens with 234 ratings, 76% five-star and a healthy 4% one-star tail.
 * Grade A, 96/100 — the engine read it correctly. What the panel *said* about
 * it did not hold up.
 */
describe('the camera-lens listing', () => {
  const listing = () => {
    const base = snapshot(13);
    return analyse({
      ...base,
      totalRatings: 234,
      reviews: base.reviews.map((r, i) => ({
        ...r,
        verified: i !== 0,
        ...(i >= 1 && i <= 3 ? { text: 'Works great, very happy with it.' } : {}),
      })),
    });
  };

  /**
   * The summary read "1 of 13 visible reviews discounted." and stopped there,
   * while three separate checks had flagged reviews between them. Nothing said
   * was false; a shopper who opened the breakdown found several times more than
   * the headline had prepared them for. That is the 0.2.0 "nothing flagged"
   * defect mirrored, and understating is not the safe direction just because it
   * is the flattering one.
   */
  it('summarises both counts, not just the flattering one', () => {
    const analysis = listing();
    expect(analysis.discountedCount).toBeGreaterThan(0);
    expect(analysis.concerningSignals).toBeGreaterThan(0);

    const { sub } = headlineFor(analysis);
    expect(sub).toMatch(/set aside/);
    expect(sub).toMatch(/check(s)? raised concern/);
  });

  it('says nothing was flagged only when nothing was', () => {
    // Ratings are deliberately not 5 or 1. The review-substance check only looks
    // at extreme ratings, and several of the fixture bodies are under fifteen
    // words, so a five-star version of this listing is legitimately flagged and
    // would have had this assertion testing the wrong sentence. Padding the
    // bodies to fix that instead gave every review an identical tail and tripped
    // the duplicate-text check — which was also correct, and is the fixture
    // hazard this repo keeps rediscovering.
    const base = snapshot(10);
    const clean = analyse({
      ...base,
      reviews: base.reviews.map((r, i) => ({ ...r, rating: (i % 2 === 0 ? 4 : 3) as Review['rating'] })),
    });

    expect(clean.discountedCount).toBe(0);
    expect(clean.concerningSignals).toBe(0);
    expect(headlineFor(clean).sub).toMatch(/Nothing flagged across 10 visible reviews/);
  });
});

/**
 * Every check on a clean listing reported "Removing this check on its own would
 * not change the grade" — seven identical copies of the same non-answer, which
 * is noise wearing the costume of transparency. The question is only live where
 * a check found something, or where the answer is yes.
 */
describe('the per-signal contribution line', () => {
  const linesIn = (analysis: ReturnType<typeof analyse>) =>
    renderPanel(analysis, { expanded: true }).shadowRoot!.querySelectorAll('.contribution').length;

  it('is dropped for a clear check that changed nothing', () => {
    const clean = analyse(snapshot(10));
    const inert = clean.signals.filter((s) => s.status === 'pass' && !s.contribution?.decisive);

    expect(inert.length, 'fixture must contain clear, non-decisive checks').toBeGreaterThan(2);
    expect(linesIn(clean)).toBe(clean.signals.length - inert.length);
  });

  it('is kept wherever a check actually flagged something', () => {
    const base = snapshot(10);
    const mixed = analyse({
      ...base,
      reviews: base.reviews.map((r, i) => ({ ...r, verified: i > 6 })),
    });

    const flagged = mixed.signals.filter((s) => s.status === 'warn' || s.status === 'fail');
    expect(flagged.length).toBeGreaterThan(0);
    expect(linesIn(mixed)).toBeGreaterThanOrEqual(flagged.length);
  });
});

/**
 * The checklist, and the promise it exists to keep.
 *
 * Winnow reads the reviews on one page. It cannot see the seller, the price,
 * where the item ships from, or whether the product is any good — and the
 * person most exposed to a bad listing is the one least likely to know that.
 * Somebody buying their first thing online reads "Reviews look genuine" as
 * "this is safe to buy", which is neither what it says nor what it can mean.
 *
 * The answer is not a wider claim. It is saying plainly where the claim stops
 * and handing over the checks that cover the rest.
 */
describe('what you can check yourself', () => {
  const open = (analysis: ReturnType<typeof analyse>) => {
    const panel = renderPanel(analysis, {});
    const shadow = panel.shadowRoot!;
    const toggle = shadow.querySelector<HTMLButtonElement>('[data-winnow-key="selfcheck"]')!;
    toggle.click();
    return { shadow, toggle, section: shadow.getElementById('winnow-selfcheck')! };
  };

  it('is collapsed by default and does not lengthen the resting panel', () => {
    const shadow = renderPanel(analyse(snapshot(8)), {}).shadowRoot!;
    expect(shadow.getElementById('winnow-selfcheck')!.hidden).toBe(true);
  });

  it('opens and closes as a proper disclosure', () => {
    const { toggle, section } = open(analyse(snapshot(8)));
    expect(section.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('winnow-selfcheck');

    toggle.click();
    expect(section.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('states plainly what Winnow cannot see', () => {
    const { section } = open(analyse(snapshot(8)));
    const text = section.textContent ?? '';
    expect(text).toMatch(/cannot see who is selling this/i);
    expect(text).toMatch(/whether the product is any good/i);
  });

  /**
   * Winnow is repeatedly asked to flag dropshipped and rebadged listings and it
   * cannot: nothing in review text reliably separates a generic product resold
   * under a new brand from an ordinary one. What is honest is describing what
   * the pattern looks like from outside so a shopper can recognise it. These
   * assertions pin that the checklist teaches the pattern and never asserts it.
   */
  it('teaches the resold-listing pattern without ever claiming to detect it', () => {
    const { section } = open(analyse(snapshot(8)));
    const text = section.textContent ?? '';

    expect(text).toMatch(/reverse image search/i);
    expect(text).toMatch(/unfamiliar brand names/i);
    expect(text).toMatch(/reviews describing a different product/i);

    // Never a verdict of its own.
    expect(text).not.toMatch(/this (product|listing|seller) is/i);
    expect(text).not.toMatch(/dropship/i);
  });

  it('adds the right situational advice on a bad grade', () => {
    const base = snapshot(10);
    const bad = analyse({
      ...base,
      totalRatings: 5_000,
      histogram: { 5: 96, 4: 2, 3: 1, 2: 0, 1: 1 },
      reviews: base.reviews.map((r) => ({ ...r, verified: false, rating: 5 as Review['rating'] })),
    });
    expect(['D', 'F']).toContain(bad.grade);

    const text = open(bad).section.textContent ?? '';
    // The distinction the whole product rests on, said out loud where it is
    // most likely to be misread.
    expect(text).toMatch(/not the same as the product being bad/i);
  });

  it('is offered, and says more, when Winnow could not read the reviews', () => {
    // Both of the states where the engine has little or nothing to give: a
    // refusal, and a grade resting on the histogram alone.
    const base = snapshot(0);
    const refused = analyse({ ...base, totalRatings: 4, histogram: undefined });
    const ratingsOnly = analyse({ ...base, totalRatings: 12_345 });

    expect(refused.insufficientData).toBe(true);
    expect(ratingsOnly.insufficientData).toBe(false);

    for (const analysis of [refused, ratingsOnly]) {
      const { section } = open(analysis);
      expect(section.hidden).toBe(false);
      expect(section.textContent).toMatch(/matters more than usual/i);
    }
  });

  it('stays open across a re-render', () => {
    document.body.innerHTML = '<div id="centerCol"></div>';
    mountPanel(analyse(snapshot(6)), {});
    panel()!.querySelector<HTMLButtonElement>('[data-winnow-key="selfcheck"]')!.click();
    expect(panel()!.getElementById('winnow-selfcheck')!.hidden).toBe(false);

    mountPanel(analyse(snapshot(7)), {});
    expect(panel()!.getElementById('winnow-selfcheck')!.hidden).toBe(false);
  });
});

describe('plain language', () => {
  /**
   * "Discounted" is the engine's word for a review it stopped counting. On a
   * shopping site it is also the word for money off — the panel was using retail
   * vocabulary to mean something else entirely, a few inches from a real price.
   */
  it('never uses "discounted" for a review, since the page uses it for a price', () => {
    const base = snapshot(10);
    const mixed = analyse({
      ...base,
      reviews: base.reviews.map((r, i) => ({ ...r, verified: i > 6, rating: 5 as Review['rating'] })),
    });
    expect(mixed.discountedCount).toBeGreaterThan(0);

    const text = renderPanel(mixed, { expanded: true }).shadowRoot!.textContent ?? '';
    expect(text).toMatch(/set aside/);
    expect(text).not.toMatch(/discounted/i);
  });

  it('glosses each number in words a first-time buyer already knows', () => {
    const text = renderPanel(analyse(snapshot(8)), {}).shadowRoot!.textContent ?? '';
    expect(text).toMatch(/The stars with the doubtful reviews set aside/);
    expect(text).toMatch(/How much of what we could read held up/);
    expect(text).toMatch(/How much evidence this is based on/);
  });
});
