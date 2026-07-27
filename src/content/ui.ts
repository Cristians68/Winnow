/**
 * On-page UI.
 *
 * Rendered into a shadow root so Amazon's stylesheets cannot bleed into our
 * panel and ours cannot leak onto their page. Everything here is presentation —
 * no scoring logic lives in this file.
 */

import type { Analysis, Grade, SignalResult } from '../core/types.js';

const HOST_ID = 'winnow-root';

const GRADE_TONE: Record<Grade, 'good' | 'mixed' | 'bad'> = {
  A: 'good',
  B: 'good',
  C: 'mixed',
  D: 'bad',
  F: 'bad',
};

const CONFIDENCE_LABEL: Record<Analysis['confidence'], string> = {
  high: 'High confidence',
  moderate: 'Moderate confidence',
  low: 'Low confidence',
  'very-low': 'Very low confidence',
};

const STATUS_LABEL: Record<SignalResult['status'], string> = {
  pass: 'Clear',
  warn: 'Caution',
  fail: 'Flagged',
  'insufficient-data': 'No data',
};

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.card {
  font-family: "Amazon Ember", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #16181d;
  background: #fff;
  border: 1px solid #d8dce3;
  border-radius: 12px;
  padding: 16px 18px;
  margin: 16px 0;
  max-width: 100%;
  box-shadow: 0 1px 3px rgba(16, 24, 40, .06);
  line-height: 1.45;
}
.head { display: flex; align-items: center; gap: 14px; }
.grade {
  flex: none;
  width: 52px; height: 52px;
  border-radius: 10px;
  display: grid; place-items: center;
  font-size: 28px; font-weight: 700; letter-spacing: -.02em;
}
.grade.good { background: #e7f6ec; color: #17663a; }
.grade.mixed { background: #fef6e7; color: #8a5a00; }
.grade.bad { background: #fdecec; color: #96231d; }
.grade.unknown { background: #f0f1f4; color: #5b6472; font-size: 22px; }
.headline { min-width: 0; }
.headline h2 { margin: 0; font-size: 16px; font-weight: 700; }
.headline p { margin: 2px 0 0; font-size: 13px; color: #5b6472; }
.ratings { display: flex; gap: 20px; margin: 14px 0 4px; flex-wrap: wrap; }
.stat { min-width: 0; }
.stat .label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; }
.stat .value { font-size: 20px; font-weight: 700; }
.stat .value.muted { color: #6b7280; font-weight: 600; font-size: 16px; }
.stat .value del { color: #9aa1ab; font-weight: 500; font-size: 14px; margin-left: 6px; }
.basis {
  font-size: 12px; color: #5b6472;
  background: #f7f8fa; border-radius: 8px;
  padding: 8px 10px; margin: 12px 0 0;
}
.toggle {
  margin-top: 12px; background: none; border: 0; padding: 0;
  font: inherit; font-size: 13px; font-weight: 600;
  color: #0b5cab; cursor: pointer; text-align: left;
}
.toggle:hover { text-decoration: underline; }
.signals { margin: 12px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.signal { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; }
.pill {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  padding: 3px 7px; border-radius: 999px; white-space: nowrap; margin-top: 2px;
}
.pill.pass { background: #e7f6ec; color: #17663a; }
.pill.warn { background: #fef6e7; color: #8a5a00; }
.pill.fail { background: #fdecec; color: #96231d; }
.pill\\.insufficient-data, .pill.insufficient-data { background: #f0f1f4; color: #5b6472; }
.signal .name { font-size: 13px; font-weight: 600; }
.signal .detail { font-size: 12.5px; color: #4b5563; margin: 1px 0 0; }
.signal .evidence { margin: 5px 0 0; padding-left: 16px; font-size: 12px; color: #6b7280; }
.signal .evidence li { margin: 2px 0; }
.foot {
  margin: 14px -18px -16px; padding: 10px 18px;
  border-top: 1px solid #eceef2; background: #fbfbfc;
  border-radius: 0 0 12px 12px;
  font-size: 11.5px; color: #6b7280;
  display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap;
}
.foot a { color: #0b5cab; text-decoration: none; }
.foot a:hover { text-decoration: underline; }
.pledge { font-weight: 600; color: #17663a; }
@media (prefers-color-scheme: dark) {
  .card { background: #16181d; border-color: #2c313a; color: #e8eaed; }
  .headline p, .stat .label, .signal .detail, .signal .evidence, .foot { color: #9aa1ab; }
  .basis { background: #1d2027; color: #9aa1ab; }
  .foot { background: #14161a; border-color: #2c313a; }
  .foot a, .toggle { color: #6fb0f0; }
  .grade.good { background: #10321f; color: #6ee7a0; }
  .grade.mixed { background: #33270c; color: #f5c66b; }
  .grade.bad { background: #3a1614; color: #f79c96; }
  .grade.unknown { background: #24272e; color: #9aa1ab; }
  .pill.pass { background: #10321f; color: #6ee7a0; }
  .pill.warn { background: #33270c; color: #f5c66b; }
  .pill.fail { background: #3a1614; color: #f79c96; }
  .pill.insufficient-data { background: #24272e; color: #9aa1ab; }
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

  const { discountedCount, sampleSize, grade } = analysis;
  const titles: Record<Grade, string> = {
    A: 'Reviews look genuine',
    B: 'Reviews look mostly genuine',
    C: 'Some reviews look questionable',
    D: 'Many reviews look manipulated',
    F: 'Reviews look heavily manipulated',
  };

  const sub =
    discountedCount === 0
      ? `Nothing flagged across ${sampleSize} visible ${sampleSize === 1 ? 'review' : 'reviews'}.`
      : `${discountedCount} of ${sampleSize} visible ${sampleSize === 1 ? 'review' : 'reviews'} discounted.`;

  return { title: titles[grade], sub };
}

function renderRatings(analysis: Analysis): HTMLElement {
  const wrap = el('div', 'ratings');

  const adjusted = el('div', 'stat');
  adjusted.append(el('div', 'label', 'Adjusted rating'));
  if (analysis.adjustedRating === null) {
    const value = el('div', 'value muted', 'Not enough to estimate');
    adjusted.append(value);
  } else {
    const value = el('div', 'value', `${analysis.adjustedRating.toFixed(1)} ★`);
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
  item.append(el('span', `pill ${signal.status}`, STATUS_LABEL[signal.status]));

  const body = el('div');
  body.append(el('div', 'name', signal.label));
  body.append(el('p', 'detail', signal.detail));

  if (signal.evidence?.length) {
    const list = el('ul', 'evidence');
    for (const line of signal.evidence.slice(0, 4)) {
      list.append(el('li', undefined, line));
    }
    body.append(list);
  }

  item.append(body);
  return item;
}

export function renderPanel(analysis: Analysis): HTMLElement {
  const host = el('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.append(style);

  const card = el('div', 'card');

  // --- header
  const head = el('div', 'head');
  const tone = analysis.insufficientData ? 'unknown' : GRADE_TONE[analysis.grade];
  head.append(el('div', `grade ${tone}`, analysis.insufficientData ? '?' : analysis.grade));

  const { title, sub } = headlineFor(analysis);
  const headline = el('div', 'headline');
  const h2 = el('h2', undefined, title);
  headline.append(h2, el('p', undefined, sub));
  head.append(headline);
  card.append(head);

  if (!analysis.insufficientData) card.append(renderRatings(analysis));

  card.append(el('p', 'basis', analysis.basis));

  // --- expandable breakdown
  const signals = el('ul', 'signals');
  signals.hidden = true;
  for (const signal of analysis.signals) signals.append(renderSignal(signal));

  const toggle = el('button', 'toggle', 'Show the breakdown') as HTMLButtonElement;
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => {
    const open = signals.hidden;
    signals.hidden = !open;
    toggle.textContent = open ? 'Hide the breakdown' : 'Show the breakdown';
    toggle.setAttribute('aria-expanded', String(open));
  });

  card.append(toggle, signals);

  // --- footer
  const foot = el('div', 'foot');
  foot.append(el('span', 'pledge', 'No affiliate links. You pay us, nobody else does.'));
  const method = document.createElement('a');
  method.href = 'https://github.com/winnow-app/winnow#methodology';
  method.target = '_blank';
  method.rel = 'noopener noreferrer';
  method.textContent = `How this is calculated (engine v${analysis.engineVersion})`;
  foot.append(method);
  card.append(foot);

  shadow.append(card);
  return host;
}

/** Insert the panel above the reviews section, or below the title as a fallback. */
export function mountPanel(analysis: Analysis): void {
  document.getElementById(HOST_ID)?.remove();
  const panel = renderPanel(analysis);

  const anchors = [
    '#reviewsMedley',
    '#customerReviews',
    '#cm-cr-dp-review-list',
    '#averageCustomerReviews',
    '#centerCol',
  ];

  for (const selector of anchors) {
    const target = document.querySelector(selector);
    if (target?.parentElement) {
      target.parentElement.insertBefore(panel, target);
      return;
    }
  }

  document.body.prepend(panel);
}
