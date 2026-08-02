// @vitest-environment happy-dom
/**
 * Frozen corpus: whole pages, parser and engine together, against a recorded result.
 *
 * See tests/corpus/README.md for what this does and does not catch — in short,
 * it pins our own drift and is structurally incapable of noticing Amazon's.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildSnapshot } from '../src/content/parse.js';
import { analyse } from '../src/core/score.js';
// @ts-expect-error -- plain ESM helper shared with the freeze tool
import { project, captureMetaFrom } from './corpus/project.mjs';

const CORPUS_DIR = join(import.meta.dirname, 'corpus');

const cases = readdirSync(CORPUS_DIR)
  .filter((f) => f.endsWith('.html'))
  .sort();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Score one fixture with the clock pinned to when it was captured.
 *
 * The clock matters: `helpfulness.ts` measures review age against `Date.now()`,
 * so without this the fixtures would quietly change grade as they got older and
 * start failing months from now with nothing having changed in the code.
 */
function run(file: string) {
  const html = readFileSync(join(CORPUS_DIR, file), 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const { url, capturedAt } = captureMetaFrom(doc);

  vi.setSystemTime(new Date(capturedAt));

  const snapshot = buildSnapshot(doc, url);
  if (!snapshot) throw new Error(`${file}: buildSnapshot returned null`);
  return project(snapshot, analyse(snapshot));
}

describe('frozen page corpus', () => {
  it('has cases to run', () => {
    // An empty directory would make every assertion below vacuous, and the suite
    // would report a confident pass over nothing at all.
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const file of cases) {
    const expectedPath = join(CORPUS_DIR, file.replace(/\.html$/, '.expected.json'));

    it(`matches the frozen result — ${file}`, () => {
      expect(
        existsSync(expectedPath),
        `No frozen result for ${file}. Run \`npm run corpus:freeze\` and read the diff before committing it.`,
      ).toBe(true);

      const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
      expect(run(file)).toEqual(expected);
    });
  }

  it('is scoring real parsed reviews rather than comparing two empty objects', () => {
    // Guards the guard. `toEqual` between two identically-empty projections
    // passes cheerfully, so a parser that returned nothing at all would look
    // exactly like a corpus in perfect health.
    for (const file of cases) {
      const result = run(file);
      expect(result.snapshot.asin, file).toMatch(/^[A-Z0-9]{10}$/);
      expect(result.snapshot.reviewCount, file).toBeGreaterThan(2);
      expect(result.analysis.insufficientData, file).toBe(false);
      expect(result.analysis.signals.length, file).toBeGreaterThan(3);
    }
  });

  it('produces a stable result across repeated runs', () => {
    for (const file of cases) expect(run(file)).toEqual(run(file));
  });

  /**
   * The corpus is worth having only if the two seeded fixtures actually
   * disagree. If both graded the same, every threshold in the engine could
   * change without a single case moving.
   */
  it('separates the honest fixture from the padded one', () => {
    const honest = run('synthetic-honest-listing.html');
    const padded = run('synthetic-padded-listing.html');

    expect(honest.analysis.trustScore).toBeGreaterThan(padded.analysis.trustScore);
    expect(honest.analysis.discountedCount).toBeLessThan(padded.analysis.discountedCount);
    expect('AB').toContain(honest.analysis.grade);
    expect('CDF').toContain(padded.analysis.grade);
  });
});
