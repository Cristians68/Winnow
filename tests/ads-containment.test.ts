/**
 * Proof that advertising never reaches the page Winnow analyses.
 *
 * This suite reads the *built* bundles, not the source. The distinction is the
 * whole point: a claim about what ships has to be checked against what ships,
 * and an import added three modules deep would be invisible to any assertion
 * made about source files.
 *
 * Every assertion here is paired with a control that proves the same search
 * can find what it is looking for somewhere else in the build. This project
 * has been bitten repeatedly by checks that passed while proving nothing —
 * seven unit tests for a digit normaliser that all passed while the parser was
 * still blind, an accessibility suite that audited zero of the states it was
 * written for. A grep with no control is a green light with no bulb in it.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

/** This suite's own build directory — see the note in tests/manifest.test.ts. */
const OUT = '.tmp-test/ads-containment';

const CONTENT_BUNDLES = [`${OUT}/content/index.js`, `${OUT}/content/serp.js`];
const WORKER_BUNDLE = `${OUT}/background/index.js`;
const POPUP_BUNDLE = `${OUT}/popup/index.js`;
const OPTIONS_BUNDLE = `${OUT}/options/index.js`;

/** Strings that would only appear if ad code had been bundled in. */
const AD_MARKERS = ['Sponsored', 'ad-slot', 'winnow:ad-request', 'ethicalads'];

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

beforeAll(() => {
  // Build once, from scratch, so the assertions cannot be reading a stale
  // dist/ left behind by an earlier run with different source.
  execFileSync(process.execPath, ['build.mjs', `--outdir=${OUT}`], { stdio: 'pipe' });
}, 60_000);

describe('the built content scripts', () => {
  it('exist, so the assertions below are reading something', () => {
    for (const bundle of CONTENT_BUNDLES) {
      expect(existsSync(bundle), `${bundle} missing`).toBe(true);
      expect(read(bundle).length).toBeGreaterThan(1000);
    }
  });

  it('contain no advertising code', () => {
    for (const bundle of CONTENT_BUNDLES) {
      const source = read(bundle);
      for (const marker of AD_MARKERS) {
        expect(source.includes(marker), `${bundle} contains "${marker}"`).toBe(false);
      }
    }
  });

  it('contain no network capability at all', () => {
    // The long-standing claim in the README. Ads must not be the thing that
    // finally makes it false.
    for (const bundle of CONTENT_BUNDLES) {
      const source = read(bundle);
      for (const pattern of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'importScripts']) {
        expect(source.includes(pattern), `${bundle} contains "${pattern}"`).toBe(false);
      }
    }
  });

  it('name no ad host', () => {
    for (const bundle of CONTENT_BUNDLES) {
      expect(read(bundle)).not.toContain('ethicalads.io');
      expect(read(bundle)).not.toContain('playyield');
    }
  });
});

describe('controls: the searches above can actually find things', () => {
  /**
   * Without these, every assertion above would pass just as happily if the
   * build produced empty files, or if `includes` were called on the wrong
   * variable. The worker is the one bundle that legitimately holds both a
   * network call and the ad markers, so it is the natural positive case.
   */
  it('finds a network call in the worker bundle', () => {
    expect(read(WORKER_BUNDLE)).toContain('fetch(');
  });

  it('finds ad code in the worker bundle', () => {
    const source = read(WORKER_BUNDLE);
    const found = AD_MARKERS.filter((marker) => source.includes(marker));
    expect(found.length, `no ad marker found in ${WORKER_BUNDLE}; the markers may be stale`).toBeGreaterThan(0);
  });

  it('finds the ad host in the worker bundle', () => {
    expect(read(WORKER_BUNDLE)).toContain('ethicalads.io');
  });
});

describe('the popup and options bundles', () => {
  /**
   * These DO carry ad code — they render the slot. What they must not carry is
   * the fetch: the worker owns every outbound request, so the extension keeps
   * exactly one network boundary rather than three.
   */
  it('render ads without being able to request them', () => {
    for (const bundle of [POPUP_BUNDLE, OPTIONS_BUNDLE]) {
      const source = read(bundle);
      expect(source.includes('fetch('), `${bundle} gained a network call`).toBe(false);
      expect(source.includes('XMLHttpRequest'), `${bundle} gained XMLHttpRequest`).toBe(false);
    }
  });

  it('control: the popup bundle does contain the ad renderer', () => {
    // Otherwise the assertion above would pass for a popup that simply has no
    // ad code in it, which would mean the slot silently stopped shipping.
    expect(read(POPUP_BUNDLE)).toContain('Sponsored');
  });
});
