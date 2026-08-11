// @vitest-environment happy-dom
/**
 * Automated accessibility auditing with axe-core.
 *
 * a11y.test.ts verifies contrast by computing it from the panel's own
 * stylesheet. This file covers the rest of the rule set — roles, names,
 * relationships, landmark structure, duplicate ids, ARIA validity — against the
 * panel as actually rendered, in every state a user can reach.
 *
 * docs/COMPLIANCE.md claims WCAG 2.2 AA. A claim like that on a product whose
 * entire pitch is calibrated honesty should be machine-checked, not asserted.
 *
 * Scope and its limits, stated plainly: axe catches roughly a third to a half of
 * WCAG issues. Passing here is necessary, not sufficient. It does not replace
 * the screen-reader pass with NVDA and VoiceOver that COMPLIANCE.md still lists
 * as outstanding — no automated tool can tell you whether the panel makes sense
 * when read aloud.
 */

import { describe, expect, it } from 'vitest';
import axe from 'axe-core';
import { renderPanel } from '../src/content/ui.js';
import type { Analysis, Grade } from '../src/core/types.js';
import { readFileSync } from 'node:fs';
import { findSearchCards } from '../src/content/serp-parse.js';
import { renderBadges, BADGE_CLASS } from '../src/content/serp-ui.js';
import type { CachedGrade } from '../src/shared/cache.js';

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    asin: 'B000000001',
    grade: 'B' as Grade,
    trustScore: 74,
    adjustedRating: 4.1,
    displayedRating: 4.6,
    discountedCount: 2,
    concerningSignals: 2,
    sampleSize: 8,
    confidence: 'moderate',
    basis: 'Based on the 8 reviews visible on this page. This is an estimate, not proof.',
    insufficientData: false,
    engineVersion: '0.1.0',
    analysedAt: new Date().toISOString(),
    assessments: [
      { reviewId: 'r1', suspicion: 0.6, reasons: ['Unverified purchase giving a 5-star rating'] },
      { reviewId: 'r2', suspicion: 0.1, reasons: [] },
    ],
    signals: [
      {
        id: 'distribution',
        label: 'Rating distribution',
        status: 'warn',
        score: 0.6,
        weight: 1.4,
        confidence: 0.8,
        detail: '92% of ratings are 5-star but only 1% are 1-star.',
        evidence: ['92% of ratings are 5-star but only 1% are 1-star.'],
        contribution: { gradeWithout: 'A', trustScoreWithout: 88, trustScoreDelta: -14, decisive: true },
      },
      {
        id: 'verified',
        label: 'Verified purchases',
        status: 'fail',
        score: 0.3,
        weight: 1,
        confidence: 0.7,
        detail: '3 of 8 visible reviews flagged.',
        evidence: ['Unverified purchase giving a 5-star rating'],
        contribution: { gradeWithout: 'B', trustScoreWithout: 76, trustScoreDelta: -2, decisive: false },
      },
      {
        id: 'burst',
        label: 'Review timing',
        status: 'pass',
        score: 1,
        weight: 1,
        confidence: 0.7,
        detail: 'Review dates are spread out rather than clustered.',
      },
      {
        id: 'depth',
        label: 'Review substance',
        status: 'insufficient-data',
        score: 0.5,
        weight: 1,
        confidence: 0,
        detail: "Winnow couldn't read the review text on this page, so this check was skipped.",
      },
    ],
    ...overrides,
  };
}

/**
 * Render into a document the way the extension does, then audit.
 *
 * The panel lives in a shadow root, so the host element is handed to axe
 * directly — axe traverses shadow boundaries, which is the whole reason the
 * panel can use one without becoming invisible to assistive technology.
 */
async function audit(node: HTMLElement): Promise<axe.AxeResults> {
  document.body.innerHTML = '';
  document.body.append(node);

  return await axe.run(node, {
    resultTypes: ['violations'],
    // Run the rule sets the compliance claim actually rests on.
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  });
}

function describeViolations(results: axe.AxeResults): string {
  return results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.html).join('\n    ')}`)
    .join('\n  ');
}

/** Every state a user can actually put the panel into. */
/** Open the self-check disclosure the way a user would, then audit the result. */
function openSelfCheck(panel: HTMLElement): HTMLElement {
  panel.shadowRoot!.querySelector<HTMLButtonElement>('[data-winnow-key="selfcheck"]')!.click();
  return panel;
}

const states: Array<[string, () => HTMLElement]> = [
  ['default (collapsed)', () => renderPanel(analysis())],
  ['expanded breakdown', () => renderPanel(analysis(), { expanded: true })],
  ['light theme', () => renderPanel(analysis(), { theme: 'light', expanded: true })],
  ['dark theme', () => renderPanel(analysis(), { theme: 'dark', expanded: true })],
  [
    'insufficient data',
    () =>
      renderPanel(
        analysis({
          insufficientData: true,
          grade: 'C',
          adjustedRating: null,
          confidence: 'very-low',
          basis: "Winnow couldn't read enough of this page to judge it.",
        }),
      ),
  ],
  // A real state on every product page: the histogram renders before the review
  // module does. It was added to this list at the same time as the state
  // itself, because a UI branch that is not in the audit list is untested by
  // construction — the same trap the feedback control fell into.
  [
    'rating breakdown only',
    () => renderPanel(analysis({ sampleSize: 0, adjustedRating: null, discountedCount: 0, confidence: 'low' })),
  ],
  // The self-check list, in both themes and in the low-information state where
  // it carries the most weight. A UI branch that is not audited is untested by
  // construction — the trap the feedback control already fell into once.
  ['self-check list open', () => openSelfCheck(renderPanel(analysis()))],
  ['self-check list open, dark', () => openSelfCheck(renderPanel(analysis(), { theme: 'dark' }))],
  [
    'self-check list open, nothing readable',
    () => openSelfCheck(renderPanel(analysis({ insufficientData: true, adjustedRating: null }))),
  ],
  ['deep analysis available', () => renderPanel(analysis(), { onDeepAnalysis: async () => {}, deepState: 'idle' })],
  ['deep analysis loading', () => renderPanel(analysis(), { onDeepAnalysis: async () => {}, deepState: 'loading' })],
  ['deep analysis done', () => renderPanel(analysis(), { onDeepAnalysis: async () => {}, deepState: 'done' })],
  [
    'deep analysis failed',
    () =>
      renderPanel(analysis(), {
        onDeepAnalysis: async () => {},
        deepState: 'error',
        deepError: 'Could not reach the deep-analysis service.',
      }),
  ],
  ['feedback control', () => renderPanel(analysis(), { onFeedback: () => {} })],
  [
    'feedback control with breakdown open',
    () => renderPanel(analysis(), { onFeedback: () => {}, expanded: true }),
  ],
  [
    'feedback control, dark theme',
    () => renderPanel(analysis(), { onFeedback: () => {}, theme: 'dark', expanded: true }),
  ],
  ...(['A', 'B', 'C', 'D', 'F'] as Grade[]).map(
    (grade): [string, () => HTMLElement] => [`grade ${grade}`, () => renderPanel(analysis({ grade }))],
  ),
];

describe('axe-core audit of the panel', () => {
  for (const [name, build] of states) {
    it(`reports no violations — ${name}`, async () => {
      const results = await audit(build());
      expect(results.violations, `\n  ${describeViolations(results)}\n`).toEqual([]);
    });
  }

  it('actually reaches the panel content, rather than passing on an empty audit', async () => {
    // Guards the guard. Every assertion above is "axe found no violations",
    // and an audit that reaches zero elements reports exactly that. The panel
    // renders entirely inside a shadow root, so if axe could not cross the
    // shadow boundary — a real possibility outside a browser — this whole file
    // would be a clean bill of health on markup nothing ever inspected.
    const panel = renderPanel(analysis(), { expanded: true });
    document.body.innerHTML = '';
    document.body.append(panel);

    const results = await axe.run(panel);
    expect(results.passes.length).toBeGreaterThan(0);

    // And prove positively that a violation planted inside the same shadow root
    // would be caught.
    const canary = document.createElement('div');
    canary.attachShadow({ mode: 'open' }).innerHTML = '<img src="x.png"><button></button>';
    document.body.append(canary);

    const canaryResults = await axe.run(canary, { resultTypes: ['violations'] });
    expect(canaryResults.violations.map((v) => v.id).sort()).toEqual(['button-name', 'image-alt']);
  });
});

/**
 * Search badges are audited separately because they are the one piece of Winnow
 * UI that is NOT in a shadow root — they sit inside Amazon's own grid. The
 * shadow-crossing proof above therefore says nothing about them, and the states
 * they can be in are different states, not more panel states.
 */
describe('axe-core audit of the search badges', () => {
  function badgedGrid(cache: Map<string, CachedGrade>): HTMLElement {
    document.body.innerHTML = readFileSync('tests/fixtures/search-synthetic.html', 'utf8')
      .replace(/^[\s\S]*?<body>/, '')
      .replace(/<\/body>[\s\S]*$/, '');
    renderBadges(findSearchCards(document), cache);
    return document.body;
  }

  const cached = (grade: Grade): Map<string, CachedGrade> => new Map([['B0REAL0001', {
    asin: 'B0REAL0001', grade, score: 42,
    engineVersion: '0.3.0', date: '2026-08-01', seen: Date.now(),
  }]]);

  // Guards the guard, exactly as the panel audit above does. "No violations" is
  // also what an audit of nothing reports, and this is the failure that let the
  // feedback UI go unaudited across 290 green tests.
  it('actually reaches the badges, rather than passing on an empty audit', async () => {
    const grid = badgedGrid(new Map());
    expect(grid.querySelectorAll(`.${BADGE_CLASS}`).length).toBeGreaterThan(0);

    const results = await axe.run(grid);
    expect(results.passes.length).toBeGreaterThan(0);
  });

  for (const [name, cache] of [
    ['not checked', new Map<string, CachedGrade>()],
    ['graded', cached('D')],
  ] as const) {
    it(`reports no violations — search badge, ${name}`, async () => {
      const results = await axe.run(badgedGrid(cache), {
        resultTypes: ['violations'],
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
        // The fixture is a bare grid with no <main>, so `region` fires on
        // Amazon's markup rather than on anything Winnow adds. Excluding the
        // one rule rather than the whole best-practice tag keeps the rest live
        // — a badge that broke `aria-valid-attr` would still be caught.
        rules: { region: { enabled: false } },
      });
      expect(results.violations, `\n  ${describeViolations(results)}\n`).toEqual([]);
    });
  }
});
