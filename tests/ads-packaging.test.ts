/**
 * What the shipped manifest is allowed to reach.
 *
 * The privacy policy names the hosts this extension can contact, so the
 * manifest and that list have to agree by construction rather than by
 * remembering. Adding advertising adds the first non-Amazon host Winnow has
 * ever shipped, which makes this the moment the guard matters most.
 *
 * The asymmetry below is the important part: an ad host belongs in
 * host_permissions, where the service worker can use it, and must never appear
 * in content_scripts[].matches, which would let ad code run on a page.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { adMatchPatterns, isKnownAdHost } from '../src/shared/ads/registry.js';
import { isKnownAmazonHost, matchPatterns } from '../src/core/marketplaces.js';

/** This suite's own build directory — see the note in tests/manifest.test.ts. */
const OUT = '.tmp-test/ads-packaging';

let manifest: {
  host_permissions?: string[];
  content_scripts?: Array<{ matches?: string[] }>;
  optional_host_permissions?: string[];
  permissions?: string[];
};

beforeAll(() => {
  execFileSync(process.execPath, ['build.mjs', `--outdir=${OUT}`], { stdio: 'pipe' });
  manifest = JSON.parse(readFileSync(`${OUT}/manifest.json`, 'utf8'));
}, 60_000);

describe('generated manifest', () => {
  it('grants exactly the Amazon storefronts plus the ad hosts', () => {
    const expected = [...matchPatterns(), ...adMatchPatterns()].sort();
    expect([...(manifest.host_permissions ?? [])].sort()).toEqual(expected);
  });

  it('grants at least one ad host, or this suite is guarding nothing', () => {
    // Control. Every assertion below is "no ad host appears where it must not";
    // they would all pass if the registry produced no ad hosts at all.
    expect(adMatchPatterns().length).toBeGreaterThan(0);
  });

  it('never lets an ad host become a content script grant', () => {
    // A host in content_scripts[].matches means code runs on that origin. Ads
    // are fetched by the worker and rendered in Winnow's own pages; there is
    // no version of this feature that needs to execute on an ad server.
    for (const script of manifest.content_scripts ?? []) {
      for (const match of script.matches ?? []) {
        expect(isKnownAdHost(match), `${match} is an ad host in content_scripts`).toBe(false);
        expect(isKnownAmazonHost(match), `${match} is not a known storefront`).toBe(true);
      }
    }
  });

  it('keeps content script matches identical to the storefront list', () => {
    for (const script of manifest.content_scripts ?? []) {
      expect([...(script.matches ?? [])].sort()).toEqual([...matchPatterns()].sort());
    }
  });

  it('grants no host that neither registry produced', () => {
    for (const host of manifest.host_permissions ?? []) {
      expect(
        isKnownAmazonHost(host) || isKnownAdHost(host),
        `${host} is in neither registry`,
      ).toBe(true);
    }
  });

  it('keeps optional hosts loopback-only', () => {
    // Advertising must not have quietly widened the developer escape hatch.
    for (const host of manifest.optional_host_permissions ?? []) {
      expect(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/\*$/.test(host)).toBe(true);
    }
  });

  it('asks for no new permission beyond storage', () => {
    expect(manifest.permissions).toEqual(['storage']);
  });

  it('names no unconfigured network anywhere in the manifest', () => {
    // playyield.invalid is a placeholder for an adapter with no verified
    // endpoint. If it ever reaches a shipped manifest, something generated
    // permissions from the wrong list.
    expect(JSON.stringify(manifest)).not.toContain('playyield');
  });
});
