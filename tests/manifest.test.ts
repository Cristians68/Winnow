import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { matchPatterns } from '../src/core/marketplaces.js';

const DIST = 'dist/manifest.json';

describe('generated manifest', () => {
  let manifest: any;

  // Build rather than read whatever happens to be in dist/. A stale build makes
  // this suite fail for a reason that has nothing to do with the code under
  // test, and — worse in the other direction — a stale build that happens to
  // match would let a registry change ship unverified.
  beforeAll(async () => {
    execFileSync(process.execPath, ['build.mjs'], { stdio: 'pipe' });
    manifest = JSON.parse(await readFile(DIST, 'utf8'));
  });

  it('lists exactly the registry storefronts as host permissions', () => {
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
  beforeAll(async () => {
    execFileSync(process.execPath, ['build.mjs'], { stdio: 'pipe' });
    chromeManifest = JSON.parse(await readFile(DIST, 'utf8'));
    execFileSync(process.execPath, ['build.mjs', '--target=firefox'], { stdio: 'pipe' });
    firefox = JSON.parse(await readFile(DIST, 'utf8'));
  });

  // Leave dist/ holding the Chrome build, which is what every other suite and
  // any manual load-unpacked expects to find there.
  afterAll(() => {
    execFileSync(process.execPath, ['build.mjs'], { stdio: 'pipe' });
  });

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
    expect([...firefox.host_permissions].sort()).toEqual([...matchPatterns()].sort());
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
