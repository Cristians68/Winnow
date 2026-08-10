import { describe, it, expect, beforeAll } from 'vitest';
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
