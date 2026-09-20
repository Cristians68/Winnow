import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { matchPatterns } from '../src/core/marketplaces.js';
import { adMatchPatterns } from '../src/shared/ads/registry.js';

/**
 * Everything the shipped build may reach: storefronts, plus the ad hosts the
 * service worker contacts for the sponsorship slot. Content scripts get the
 * storefront list alone — see the assertions below.
 */
const allHosts = () => [...matchPatterns(), ...adMatchPatterns()];

/**
 * This suite's own build directory.
 *
 * Three suites build the extension and vitest runs them in parallel worker
 * processes. They used to share dist/, and build.mjs starts by removing its
 * output directory — so whichever suite lost the race read a half-written
 * tree and failed with `EEXIST: mkdir dist/icons`. Each suite now builds
 * somewhere private, which removes the race instead of hiding it by forcing
 * the files to run sequentially.
 */
const OUT = '.tmp-test/manifest';
const DIST = `${OUT}/manifest.json`;

describe('generated manifest', () => {
  let manifest: any;

  // Build rather than read whatever happens to be in dist/. A stale build makes
  // this suite fail for a reason that has nothing to do with the code under
  // test, and — worse in the other direction — a stale build that happens to
  // match would let a registry change ship unverified.
  beforeAll(async () => {
    execFileSync(process.execPath, ['build.mjs', `--outdir=${OUT}`], { stdio: 'pipe' });
    manifest = JSON.parse(await readFile(DIST, 'utf8'));
  });

  it('lists exactly the registry storefronts plus the ad hosts', () => {
    expect([...manifest.host_permissions].sort()).toEqual([...allHosts()].sort());
  });

  it('grants ad hosts to the worker but never to a content script', () => {
    // The asymmetry is the point. A host in content_scripts[].matches means
    // code runs on that origin, and a sponsorship slot has no business
    // executing on an ad server. host_permissions is what the worker needs.
    //
    // adMatchPatterns() is empty today — no network is configured — so this
    // loop guards nothing yet and the assertion below says so explicitly
    // rather than letting an empty loop read as a pass.
    for (const adHost of adMatchPatterns()) {
      expect(manifest.host_permissions).toContain(adHost);
      for (const script of manifest.content_scripts) {
        expect(script.matches).not.toContain(adHost);
      }
    }
  });

  it('ships with no advertising reach while no network is configured', () => {
    expect(adMatchPatterns()).toEqual([]);
    expect([...manifest.host_permissions].sort()).toEqual([...matchPatterns()].sort());
  });

  it('gives every content script the same host list', () => {
    expect(manifest.content_scripts.length).toBeGreaterThan(0);
    for (const script of manifest.content_scripts) {
      expect([...script.matches].sort()).toEqual([...matchPatterns()].sort());
    }
  });

  // The permission set is a product promise, printed in PRIVACY.md and on the
  // store listing. It is not allowed to grow by accident.
  it('requests storage and nothing else', () => {
    expect(manifest.permissions).toEqual(['storage']);
  });

  it('keeps optional host permissions loopback-only', () => {
    for (const host of manifest.optional_host_permissions ?? []) {
      expect(host).toMatch(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/\*$/);
    }
  });
});

describe('firefox target', () => {
  let firefox: any;
  let chromeManifest: any;

  // Reads both manifests itself rather than reaching for the `manifest`
  // variable above. That one is scoped to its own block, and sharing build
  // output across sibling blocks would make the two suites order-dependent.
  const FF_OUT = '.tmp-test/manifest-firefox';

  beforeAll(async () => {
    execFileSync(process.execPath, ['build.mjs', `--outdir=${OUT}`], { stdio: 'pipe' });
    chromeManifest = JSON.parse(await readFile(DIST, 'utf8'));
    execFileSync(process.execPath, ['build.mjs', '--target=firefox', `--outdir=${FF_OUT}`], {
      stdio: 'pipe',
    });
    firefox = JSON.parse(await readFile(`${FF_OUT}/manifest.json`, 'utf8'));
  });

  // Nothing to restore: neither build touched dist/, so whatever a developer
  // had loaded unpacked is still there. The previous version of this block
  // rebuilt dist/ in afterAll precisely because it had overwritten it.
  afterAll(() => {});

  it('declares a stable gecko id and a minimum version', () => {
    expect(firefox.browser_specific_settings.gecko.id).toBe('winnow@winnow.tools');
    expect(firefox.browser_specific_settings.gecko.strict_min_version).toBeTruthy();
  });

  it('declares a background script alongside the service worker', () => {
    expect(firefox.background.scripts).toEqual(['background/index.js']);
    expect(firefox.background.service_worker).toBe('background/index.js');
  });

  // Proves the two builds are actually different documents. Every assertion
  // below is "firefox matches chrome", and all of them would also pass if the
  // flag were ignored entirely and both reads returned the same file.
  it('does not put the gecko keys in the chrome build', () => {
    expect(chromeManifest.browser_specific_settings).toBeUndefined();
    expect(chromeManifest.background.scripts).toBeUndefined();
  });

  // The two builds must never diverge in what they ask the user for. A
  // permission that appears in one and not the other is a promise kept in one
  // browser and broken in the other.
  it('asks for exactly what the chrome build asks for', () => {
    expect(firefox.permissions).toEqual(chromeManifest.permissions);
    expect([...firefox.host_permissions].sort()).toEqual([...allHosts()].sort());
    expect([...(firefox.optional_host_permissions ?? [])].sort())
      .toEqual([...(chromeManifest.optional_host_permissions ?? [])].sort());
  });

  it('gives every content script the same host list in both builds', () => {
    expect(firefox.content_scripts.length).toBe(chromeManifest.content_scripts.length);
    for (const script of firefox.content_scripts) {
      expect([...script.matches].sort()).toEqual([...matchPatterns()].sort());
    }
  });
});
