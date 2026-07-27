// @vitest-environment happy-dom
/**
 * Accessibility verification.
 *
 * COMPLIANCE.md previously listed contrast as "Partial — computed by design,
 * not yet machine-verified". This file makes that claim real: it parses the
 * panel's own stylesheet and computes every foreground/background pair, so a
 * future colour tweak that breaks WCAG fails the build rather than shipping.
 *
 * Targets WCAG 2.2 AA, which EN 301 549 adopts and which the European
 * Accessibility Act therefore requires, and which US ADA case law converges on.
 */
import { describe, it, expect } from 'vitest';
import { renderPanel, STYLES, LIGHT_TOKENS, DARK_TOKENS } from '../src/content/ui.js';
import type { Analysis } from '../src/core/types.js';

// --- contrast maths (WCAG 2.x relative luminance) --------------------------

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

/** Parse a `--name: #value;` token block into a lookup. */
function tokens(block: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{3,6})\b/gi)) {
    map[name!] = value!;
  }
  return map;
}

/**
 * The semantic foreground/background pairs the panel actually renders.
 * Both themes must satisfy every one of them.
 */
const PAIRS: Array<[fg: string, bg: string, label: string]> = [
  ['--text', '--bg', 'body text'],
  ['--muted', '--bg', 'secondary text'],
  ['--muted-strong', '--surface', 'basis line'],
  ['--link', '--bg', 'links and toggle'],
  ['--good-fg', '--good-bg', 'clear pill / grade A'],
  ['--mixed-fg', '--mixed-bg', 'caution pill / grade C'],
  ['--bad-fg', '--bad-bg', 'flagged pill / grade F'],
  ['--none-fg', '--none-bg', 'no-data pill'],
  ['--good-fg', '--foot-bg', 'no-affiliate pledge'],
  ['--link', '--foot-bg', 'footer link'],
  ['--muted', '--foot-bg', 'footer text'],
  ['--strike', '--bg', 'struck-through original rating'],
];

describe('colour contrast (WCAG 2.2 AA)', () => {
  const themes = { light: tokens(LIGHT_TOKENS), dark: tokens(DARK_TOKENS) };

  it('defines the same tokens in both themes, so neither can silently drift', () => {
    expect(Object.keys(themes.light).sort()).toEqual(Object.keys(themes.dark).sort());
    expect(Object.keys(themes.light).length).toBeGreaterThan(15);
  });

  for (const [name, theme] of Object.entries(themes)) {
    it(`every ${name} pair meets 4.5:1`, () => {
      const failures = PAIRS.map(([fg, bg, label]) => {
        const fgHex = theme[fg]!;
        const bgHex = theme[bg]!;
        return { label, ratio: contrastRatio(fgHex, bgHex), fgHex, bgHex };
      })
        .filter((r) => r.ratio < 4.5)
        .map((r) => `${r.label}: ${r.fgHex} on ${r.bgHex} = ${r.ratio.toFixed(2)}:1`);

      expect(failures).toEqual([]);
    });
  }

  it('white button text clears 4.5:1 on the deep-analysis button in both themes', () => {
    for (const theme of Object.values(themes)) {
      expect(contrastRatio('#ffffff', theme['--deep-bg']!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('computes known ratios correctly', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});

// --- structural accessibility ----------------------------------------------

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    asin: 'B08N5WRWNW',
    grade: 'D',
    trustScore: 42,
    adjustedRating: 3.9,
    displayedRating: 4.6,
    discountedCount: 5,
    sampleSize: 13,
    confidence: 'moderate',
    basis: 'Based on the 13 reviews visible on this page. This is an estimate, not proof.',
    signals: [
      { id: 'distribution', label: 'Rating distribution', status: 'fail', score: 0.2, weight: 1.4, confidence: 1, detail: 'Hollow middle.', evidence: ['100% 5-star'] },
      { id: 'verified', label: 'Verified purchases', status: 'warn', score: 0.6, weight: 1, confidence: 1, detail: '4 of 13 flagged.' },
      { id: 'burst', label: 'Review timing', status: 'pass', score: 1, weight: 1, confidence: 1, detail: 'Spread out.' },
    ],
    assessments: [],
    insufficientData: false,
    engineVersion: '0.1.0',
    analysedAt: new Date().toISOString(),
    ...overrides,
  };
}

function shadowOf(a: Analysis, options = {}): ShadowRoot {
  const host = renderPanel(a, options);
  document.body.append(host);
  return host.shadowRoot!;
}

describe('panel structure', () => {
  it('exposes a labelled landmark region', () => {
    const shadow = shadowOf(analysis());
    const region = shadow.querySelector('[role="region"]')!;
    expect(region).toBeTruthy();
    const heading = shadow.getElementById(region.getAttribute('aria-labelledby')!);
    expect(heading?.tagName).toBe('H2');
    expect(heading?.textContent).toMatch(/Winnow/);
  });

  it('gives the grade badge a text alternative rather than relying on the letter', () => {
    const badge = shadowOf(analysis()).querySelector('[role="img"]')!;
    expect(badge.getAttribute('aria-label')).toBe('Grade D of A to F. Many reviews look manipulated.');
  });

  it('labels every status with text, never colour alone', () => {
    const shadow = shadowOf(analysis(), { expanded: true });
    const pills = [...shadow.querySelectorAll('.pill')].map((p) => p.textContent);
    expect(pills).toContain('Flagged');
    expect(pills).toContain('Caution');
    expect(pills).toContain('Clear');
  });

  it('wires the disclosure button to the region it controls', () => {
    const shadow = shadowOf(analysis());
    const toggle = shadow.querySelector('.toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const controlled = shadow.getElementById(toggle.getAttribute('aria-controls')!);
    expect(controlled).toBeTruthy();
    expect((controlled as HTMLElement).hidden).toBe(true);

    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect((controlled as HTMLElement).hidden).toBe(false);
  });

  it('announces async results in a polite live region that does not steal focus', () => {
    const status = shadowOf(analysis()).querySelector('[role="status"]')!;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.hasAttribute('autofocus')).toBe(false);
  });

  it('uses real buttons so keyboard operation works without custom handlers', () => {
    const shadow = shadowOf(analysis(), { onDeepAnalysis: async () => {} });
    for (const button of shadow.querySelectorAll('button')) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
    }
  });

  it('marks the deep-analysis button busy while it runs', () => {
    const shadow = shadowOf(analysis(), { onDeepAnalysis: async () => {} });
    const deep = shadow.querySelector('.deep') as HTMLButtonElement;
    deep.click();
    expect(deep.getAttribute('aria-busy')).toBe('true');
    expect(deep.disabled).toBe(true);
  });

  it('hides decorative glyphs from screen readers', () => {
    const shadow = shadowOf(analysis());
    // The star next to the adjusted rating is decorative; "stars" is read instead.
    expect(shadow.querySelector('.sr-only')?.textContent).toMatch(/stars/);
    const star = [...shadow.querySelectorAll('span')].find((s) => s.textContent?.includes('★'));
    expect(star?.getAttribute('aria-hidden')).toBe('true');
  });

  it('declares its language, since it sits inside localised Amazon pages', () => {
    expect(shadowOf(analysis()).querySelector('[role="region"]')?.getAttribute('lang')).toBe('en');
  });

  it('opens external links safely', () => {
    for (const link of shadowOf(analysis()).querySelectorAll('a[target="_blank"]')) {
      expect(link.getAttribute('rel')).toMatch(/noopener/);
      expect(link.getAttribute('rel')).toMatch(/noreferrer/);
    }
  });

  it('makes the hidden attribute win over the display value', () => {
    // Regression: `.signals { display: grid }` defeated [hidden], so the
    // breakdown was permanently visible and the disclosure button did nothing.
    expect(STYLES).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });

  it('applies an explicit theme class when the user overrides the system setting', () => {
    expect(shadowOf(analysis(), { theme: 'dark' }).querySelector('.card')!.className).toContain('theme-dark');
    expect(shadowOf(analysis(), { theme: 'light' }).querySelector('.card')!.className).toContain('theme-light');
    expect(shadowOf(analysis(), { theme: 'system' }).querySelector('.card')!.className).not.toMatch(/theme-/);
  });

  it('honours reduced-motion and keeps focus visible', () => {
    expect(STYLES).toMatch(/prefers-reduced-motion/);
    expect(STYLES).toMatch(/:focus-visible/);
  });

  it('meets the 24px minimum target size', () => {
    const minHeight = STYLES.match(/button\s*\{[^}]*min-height:\s*(\d+)px/)?.[1];
    expect(Number(minHeight)).toBeGreaterThanOrEqual(24);
  });
});
