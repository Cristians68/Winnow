/**
 * On-page UI.
 *
 * Rendered into a shadow root so Amazon's stylesheets cannot bleed into our
 * panel and ours cannot leak onto their page.
 *
 * Accessibility (WCAG 2.2 AA / ADA / EN 301 549, which the European
 * Accessibility Act requires):
 *  · The panel is a labelled landmark region, announced politely when it
 *    appears rather than stealing focus from whatever the user was doing.
 *  · Status is never carried by colour alone — every pill has a text label, and
 *    the grade has a text alternative for screen readers.
 *  · All colour pairs meet 4.5:1 contrast in both light and dark themes.
 *  · Full keyboard operation with a visible :focus-visible indicator; all
 *    targets are at least 24x24px (WCAG 2.2 "Target Size (Minimum)").
 *  · Async results land in a live region so they are announced when ready.
 *  · Motion is suppressed entirely under prefers-reduced-motion.
 */

import type { Analysis, Grade, SignalResult } from '../core/types.js';
import { buildVerdict } from '../core/verdict.js';

const HOST_ID = 'winnow-root';

const GRADE_TONE: Record<Grade, 'good' | 'mixed' | 'bad'> = {
  A: 'good', B: 'good', C: 'mixed', D: 'bad', F: 'bad',
};

const GRADE_MEANING: Record<Grade, string> = {
  A: 'Grade A of A to F. Reviews look genuine.',
  B: 'Grade B of A to F. Reviews look mostly genuine.',
  C: 'Grade C of A to F. Some reviews look questionable.',
  D: 'Grade D of A to F. Many reviews look manipulated.',
  F: 'Grade F of A to F. Reviews look heavily manipulated.',
};

const CONFIDENCE_LABEL: Record<Analysis['confidence'], string> = {
  high: 'High confidence', moderate: 'Moderate confidence',
  low: 'Low confidence', 'very-low': 'Very low confidence',
};

const STATUS_LABEL: Record<SignalResult['status'], string> = {
  pass: 'Clear', warn: 'Caution', fail: 'Flagged', 'insufficient-data': 'No data',
};

/**
 * Colour tokens are chosen for contrast, not just aesthetics. Foreground values
 * clear 4.5:1 against their paired surface in both themes.
 */
export const LIGHT_TOKENS = `
  --bg: #ffffff;
  --border: #d3d8e0;
  --text: #16181d;
  --muted: #545c68;
  --muted-strong: #4a525e;
  --surface: #f5f6f8;
  --foot-bg: #fafbfc;
  --foot-line: #e8ebf0;
  --link: #0a4f9c;
  --focus: #0a5cb8;
  --good-bg: #e3f5ea;  --good-fg: #125c33;
  --mixed-bg: #fdf3e3; --mixed-fg: #7a4e00;
  --bad-bg: #fdeaea;   --bad-fg: #8c1f19;
  --none-bg: #eef0f3;  --none-fg: #4a525e;
  --btn-border: #858e9c;
  --btn-hover: #f2f5fa;
  --deep-bg: #12395f;
  --deep-hover: #0d2b49;
  --shadow: 0 1px 2px rgba(16,24,40,.04), 0 4px 16px rgba(16,24,40,.05);
  --strike: #6b7280;
`;

export const DARK_TOKENS = `
  --bg: #16181d;
  --border: #333944;
  --text: #e9ebee;
  --muted: #a8b0ba;
  --muted-strong: #a8b0ba;
  --surface: #1e2128;
  --foot-bg: #131519;
  --foot-line: #333944;
  --link: #7cb8f5;
  --focus: #7cb8f5;
  --good-bg: #0e2f1c;  --good-fg: #74e3a2;
  --mixed-bg: #302408; --mixed-fg: #f2c76a;
  --bad-bg: #371411;   --bad-fg: #f79a94;
  --none-bg: #232730;  --none-fg: #a8b0ba;
  --btn-border: #6b7480;
  --btn-hover: #232730;
  --deep-bg: #2a6db5;
  --deep-hover: #3480d0;
  --shadow: none;
  --strike: #949ca6;
`;

/**
 * Themed with custom properties so an explicit user choice can override the
 * system preference. The token sets are interpolated into both the media query
 * and the explicit `.theme-dark` selector, so the two can never drift apart.
 */
export const STYLES = `
:host { all: initial; display: block; }
* { box-sizing: border-box; }

.card { ${LIGHT_TOKENS} }
@media (prefers-color-scheme: dark) { .card:not(.theme-light) { ${DARK_TOKENS} } }
.card.theme-dark { ${DARK_TOKENS} }
.card.theme-light { ${LIGHT_TOKENS} }

/* The hidden attribute only sets display:none via the UA stylesheet, so any
   author display value silently defeats it. This kept the breakdown list
   permanently visible and made the disclosure button appear to do nothing. */
[hidden] { display: none !important; }

.card {
  font-family: "Amazon Ember", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 18px 20px;
  margin: 16px 0;
  box-shadow: var(--shadow);
  line-height: 1.5;
  animation: winnow-in .28s cubic-bezier(.2,.7,.3,1) both;
}
@keyframes winnow-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.head { display: flex; align-items: center; gap: 14px; }
.grade {
  flex: none; width: 54px; height: 54px; border-radius: 12px;
  display: grid; place-items: center;
  font-size: 29px; font-weight: 700; letter-spacing: -.02em;
}
.grade.good    { background: var(--good-bg);  color: var(--good-fg); }
.grade.mixed   { background: var(--mixed-bg); color: var(--mixed-fg); }
.grade.bad     { background: var(--bad-bg);   color: var(--bad-fg); }
.grade.unknown { background: var(--none-bg);  color: var(--none-fg); font-size: 23px; }

.headline { min-width: 0; }
.headline h2 { margin: 0; font-size: 16.5px; font-weight: 700; letter-spacing: -.005em; }
.headline p { margin: 2px 0 0; font-size: 13px; color: var(--muted); }

.ratings { display: flex; gap: 22px; margin: 16px 0 2px; flex-wrap: wrap; }
.stat .label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
.stat .value { font-size: 21px; font-weight: 700; letter-spacing: -.01em; }
.stat .value.muted { color: var(--muted); font-weight: 600; font-size: 15px; }
.stat .value del { color: var(--strike); font-weight: 500; font-size: 14px; margin-left: 7px; }

.verdict {
  margin: 12px 0 0; padding: 11px 13px;
  background: var(--surface); border-radius: 9px;
  border-left: 4px solid var(--none-fg);
}
.verdict.good { border-left-color: var(--good-fg); }
.verdict.mixed { border-left-color: var(--mixed-fg); }
.verdict.bad { border-left-color: var(--bad-fg); }
.verdict-head {
  margin: 0 0 3px; font-size: 13.5px; font-weight: 700; color: var(--text);
}
.verdict-body {
  margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--muted-strong);
}

.basis {
  font-size: 12.5px; color: var(--muted-strong);
  background: var(--surface); border-radius: 9px;
  padding: 9px 11px; margin: 13px 0 0;
}

.actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 13px; }
button {
  font: inherit; font-size: 13px; font-weight: 600;
  min-height: 32px; padding: 6px 12px;
  border-radius: 8px; cursor: pointer;
  transition: background-color .15s ease, border-color .15s ease;
}
button:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }

.toggle { background: none; border: 1px solid var(--btn-border); color: var(--link); }
.toggle:hover { background: var(--btn-hover); border-color: var(--focus); }

.deep { background: var(--deep-bg); border: 1px solid var(--deep-bg); color: #fff; }
.deep:hover:not(:disabled) { background: var(--deep-hover); }
.deep:disabled { opacity: .65; cursor: progress; }

.spinner {
  display: inline-block; width: 12px; height: 12px; margin-right: 7px;
  border: 2px solid rgba(255,255,255,.4); border-top-color: #fff;
  border-radius: 50%; animation: winnow-spin .7s linear infinite;
  vertical-align: -1px;
}
@keyframes winnow-spin { to { transform: rotate(360deg); } }

.note { font-size: 12px; color: var(--muted); margin: 9px 0 0; }
.note.error { color: var(--bad-fg); }

.signals { margin: 13px 0 0; padding: 0; list-style: none; display: grid; gap: 9px; }
.signal { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; }
.pill {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  padding: 3px 7px; border-radius: 999px; white-space: nowrap; margin-top: 3px;
}
.pill.pass { background: var(--good-bg);  color: var(--good-fg); }
.pill.warn { background: var(--mixed-bg); color: var(--mixed-fg); }
.pill.fail { background: var(--bad-bg);   color: var(--bad-fg); }
.pill.insufficient-data { background: var(--none-bg); color: var(--none-fg); }
.signal .name { font-size: 13px; font-weight: 600; }
.signal .detail { font-size: 12.5px; color: var(--muted-strong); margin: 1px 0 0; }
.signal .evidence { margin: 5px 0 0; padding-left: 17px; font-size: 12px; color: var(--muted); }
.signal .evidence li { margin: 2px 0; }

.foot {
  margin: 15px -20px -18px; padding: 11px 20px;
  border-top: 1px solid var(--foot-line); background: var(--foot-bg);
  border-radius: 0 0 14px 14px;
  font-size: 11.5px; color: var(--muted);
  display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap;
}
.foot a { color: var(--link); }
.foot a:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; border-radius: 3px; }
.pledge { font-weight: 600; color: var(--good-fg); }

.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .card { animation: none; }
  .spinner { animation-duration: 2s; }
  button { transition: none; }
}
`;

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function headlineFor(analysis: Analysis): { title: string; sub: string } {
  if (analysis.insufficientData) {
    return {
      title: "Couldn't read this page",
      sub: 'Winnow needs the review section to be visible to say anything useful.',
    };
  }

  const titles: Record<Grade, string> = {
    A: 'Reviews look genuine',
    B: 'Reviews look mostly genuine',
    C: 'Some reviews look questionable',
    D: 'Many reviews look manipulated',
    F: 'Reviews look heavily manipulated',
  };

  const { discountedCount, concerningSignals, sampleSize } = analysis;
  const noun = sampleSize === 1 ? 'review' : 'reviews';

  // Three cases, because two counts can disagree. A review can be flagged by a
  // check without accumulating enough suspicion to be discounted, and saying
  // "nothing flagged" in that situation put the summary in direct contradiction
  // with a FLAGGED row a few pixels below it. If any check raised a concern, the
  // summary says so even when no individual review was discounted.
  const sub = (() => {
    if (discountedCount > 0) {
      return `${discountedCount} of ${sampleSize} visible ${noun} discounted.`;
    }
    if (concerningSignals > 0) {
      return concerningSignals === 1
        ? `No review was discounted, but 1 check raised a concern.`
        : `No review was discounted, but ${concerningSignals} checks raised concerns.`;
    }
    return `Nothing flagged across ${sampleSize} visible ${noun}.`;
  })();

  return { title: titles[analysis.grade], sub };
}

/**
 * The "so should I buy it?" block.
 *
 * Deliberately a `<section>` with its own heading rather than another styled
 * paragraph: it answers a different question from everything around it, and a
 * screen-reader user should be able to find it without reading the breakdown.
 * The tone class only tints a border — the meaning is entirely in the words, so
 * this still satisfies "colour is never the sole carrier of meaning".
 */
function renderVerdict(analysis: Analysis): HTMLElement {
  const { headline, advice, tone } = buildVerdict(analysis);

  const wrap = el('section', `verdict ${tone}`);
  wrap.setAttribute('aria-labelledby', 'winnow-verdict-heading');

  const heading = el('h3', 'verdict-head', headline);
  heading.id = 'winnow-verdict-heading';

  wrap.append(heading, el('p', 'verdict-body', advice));
  return wrap;
}

function renderRatings(analysis: Analysis): HTMLElement {
  const wrap = el('div', 'ratings');

  const adjusted = el('div', 'stat');
  adjusted.append(el('div', 'label', 'Adjusted rating'));
  if (analysis.adjustedRating === null) {
    adjusted.append(el('div', 'value muted', 'Not enough to estimate'));
  } else {
    const value = el('div', 'value');
    // Screen readers get "4.2 stars", not "4.2 black star".
    value.append(el('span', undefined, analysis.adjustedRating.toFixed(1)));
    const star = el('span', undefined, ' ★');
    star.setAttribute('aria-hidden', 'true');
    value.append(star, el('span', 'sr-only', ' stars'));

    if (
      analysis.displayedRating !== null &&
      Math.abs(analysis.displayedRating - analysis.adjustedRating) >= 0.1
    ) {
      const was = document.createElement('del');
      was.textContent = `was ${analysis.displayedRating.toFixed(1)}`;
      value.append(was);
    }
    adjusted.append(value);
  }
  wrap.append(adjusted);

  const trust = el('div', 'stat');
  trust.append(el('div', 'label', 'Trust score'));
  trust.append(el('div', 'value', `${analysis.trustScore}/100`));
  wrap.append(trust);

  const confidence = el('div', 'stat');
  confidence.append(el('div', 'label', 'Confidence'));
  confidence.append(el('div', 'value muted', CONFIDENCE_LABEL[analysis.confidence]));
  wrap.append(confidence);

  return wrap;
}

function renderSignal(signal: SignalResult): HTMLElement {
  const item = el('li', 'signal');

  const pill = el('span', `pill ${signal.status}`, STATUS_LABEL[signal.status]);
  item.append(pill);

  const body = el('div');
  body.append(el('div', 'name', signal.label));
  body.append(el('p', 'detail', signal.detail));

  if (signal.evidence?.length) {
    const list = el('ul', 'evidence');
    for (const line of signal.evidence.slice(0, 4)) list.append(el('li', undefined, line));
    body.append(list);
  }

  item.append(body);
  return item;
}

export interface PanelOptions {
  expanded?: boolean;
  /** 'system' follows the OS; 'light' and 'dark' override it. */
  theme?: 'system' | 'light' | 'dark';
  /** Invoked when the user asks for deep analysis. Omit to hide the button. */
  onDeepAnalysis?: () => Promise<void>;
  deepState?: 'idle' | 'loading' | 'done' | 'error';
  deepError?: string;
}

export function renderPanel(analysis: Analysis, options: PanelOptions = {}): HTMLElement {
  const host = el('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.append(style);

  const theme = options.theme ?? 'system';
  const card = el('section', `card${theme === 'system' ? '' : ` theme-${theme}`}`);
  card.setAttribute('role', 'region');
  card.setAttribute('aria-labelledby', 'winnow-heading');
  card.setAttribute('lang', 'en');

  // --- header
  const head = el('div', 'head');
  const tone = analysis.insufficientData ? 'unknown' : GRADE_TONE[analysis.grade];
  const grade = el('div', `grade ${tone}`, analysis.insufficientData ? '?' : analysis.grade);
  grade.setAttribute('role', 'img');
  grade.setAttribute(
    'aria-label',
    analysis.insufficientData ? 'No grade available' : GRADE_MEANING[analysis.grade],
  );
  head.append(grade);

  const { title, sub } = headlineFor(analysis);
  const headline = el('div', 'headline');
  const h2 = el('h2', undefined, `Winnow — ${title}`);
  h2.id = 'winnow-heading';
  headline.append(h2, el('p', undefined, sub));
  head.append(headline);
  card.append(head);

  if (!analysis.insufficientData) card.append(renderRatings(analysis));
  card.append(renderVerdict(analysis));
  card.append(el('p', 'basis', analysis.basis));

  // --- breakdown
  const signals = el('ul', 'signals');
  signals.id = 'winnow-signals';
  const startExpanded = options.expanded ?? false;
  signals.hidden = !startExpanded;
  for (const signal of analysis.signals) signals.append(renderSignal(signal));

  const actions = el('div', 'actions');

  const toggle = el('button', 'toggle', startExpanded ? 'Hide the breakdown' : 'Show the breakdown') as HTMLButtonElement;
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(startExpanded));
  toggle.setAttribute('aria-controls', 'winnow-signals');
  toggle.addEventListener('click', () => {
    const open = signals.hidden;
    signals.hidden = !open;
    toggle.textContent = open ? 'Hide the breakdown' : 'Show the breakdown';
    toggle.setAttribute('aria-expanded', String(open));
  });
  actions.append(toggle);

  // --- deep analysis (explicitly user-initiated; see PRIVACY.md)
  const liveRegion = el('p', 'note');
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');

  if (options.onDeepAnalysis && !analysis.insufficientData) {
    const deep = el('button', 'deep') as HTMLButtonElement;
    deep.type = 'button';

    const setLabel = (label: string, busy: boolean) => {
      deep.textContent = '';
      if (busy) {
        const spinner = el('span', 'spinner');
        spinner.setAttribute('aria-hidden', 'true');
        deep.append(spinner);
      }
      deep.append(document.createTextNode(label));
      deep.disabled = busy;
      deep.setAttribute('aria-busy', String(busy));
    };

    if (options.deepState === 'done') {
      setLabel('Deep analysis complete', false);
      deep.disabled = true;
      liveRegion.textContent = 'Deep analysis complete. The grade above has been updated.';
    } else if (options.deepState === 'error') {
      setLabel('Retry deep analysis', false);
      liveRegion.textContent = options.deepError ?? 'Deep analysis failed.';
      liveRegion.classList.add('error');
    } else {
      setLabel('Run deep analysis', false);
    }

    deep.addEventListener('click', () => {
      setLabel('Analysing…', true);
      liveRegion.classList.remove('error');
      liveRegion.textContent = 'Running deep analysis. This checks other products for matching review patterns.';
      void options.onDeepAnalysis!();
    });

    actions.append(deep);
  }

  card.append(actions, liveRegion, signals);

  // --- footer
  const foot = el('div', 'foot');
  foot.append(el('span', 'pledge', 'No affiliate links. Free, and nobody pays us.'));
  const method = document.createElement('a');
  method.href = 'https://github.com/Cristians68/Winnow#methodology';
  method.target = '_blank';
  method.rel = 'noopener noreferrer';
  method.textContent = `How this is calculated (engine v${analysis.engineVersion})`;
  foot.append(method);
  card.append(foot);

  shadow.append(card);
  return host;
}

/** Insert the panel above the reviews section, or at the top of the column as a fallback. */
export function mountPanel(analysis: Analysis, options: PanelOptions = {}): void {
  document.getElementById(HOST_ID)?.remove();
  const panel = renderPanel(analysis, options);

  for (const selector of ['#reviewsMedley', '#customerReviews', '#cm-cr-dp-review-list', '#averageCustomerReviews', '#centerCol']) {
    const target = document.querySelector(selector);
    if (target?.parentElement) {
      target.parentElement.insertBefore(panel, target);
      return;
    }
  }
  document.body.prepend(panel);
}
