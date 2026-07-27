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

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    asin: 'B000000001',
    grade: 'B' as Grade,
    trustScore: 74,
    adjustedRating: 4.1,
    displayedRating: 4.6,
    discountedCount: 2,
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
