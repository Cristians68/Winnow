import * as esbuild from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { matchPatterns } from './src/core/marketplaces.ts';
import { adMatchPatterns } from './src/shared/ads/registry.ts';

const watch = process.argv.includes('--watch');

/**
 * Where the build lands. Defaults to dist/, which is what load-unpacked and
 * the packaging script expect.
 *
 * Overridable because more than one test suite needs a build of its own, and
 * they run in parallel worker processes. Sharing dist/ made them race: the
 * first line of this script removes the directory the others are mid-way
 * through writing, which surfaced as `EEXIST: mkdir dist/icons` in whichever
 * suite lost. Giving each its own directory removes the race rather than
 * papering over it by forcing the suites to run one at a time.
 */
const outdir = (process.argv.find((a) => a.startsWith('--outdir=')) ?? '--outdir=dist').split('=')[1];
if (!outdir) throw new Error('--outdir= requires a value');

/**
 * Which browser this build is for.
 *
 * Unknown values throw rather than falling back to Chrome. A typo'd flag that
 * silently produced a Chrome build would be discovered by a Firefox reviewer,
 * not by us.
 */
const target = (process.argv.find((a) => a.startsWith('--target=')) ?? '--target=chrome').split('=')[1];
if (!['chrome', 'firefox'].includes(target)) {
  throw new Error(`unknown --target=${target}; expected chrome or firefox`);
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

/** Entry points that become their own bundles in the extension. */
const entryPoints = {
  'content/index': 'src/content/index.ts',
  'content/serp': 'src/content/serp.ts',
  'background/index': 'src/background/index.ts',
  'popup/index': 'src/popup/index.ts',
  'options/index': 'src/options/index.ts',
};

const buildOptions = {
  entryPoints,
  outdir,
  bundle: true,
  // Content scripts cannot be ES modules, so everything ships as IIFE for
  // consistency. The service worker is declared without `type: module` to match.
  format: 'iife',
  target: ['chrome120'],
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
  legalComments: 'none',
};

/** Copy static assets and the manifest into dist. */
async function copyStatic() {
  await cp('src/manifest.json', path.join(outdir, 'manifest.json'));
  for (const dir of ['public', 'src/popup/ui', 'src/options/ui']) {
    if (existsSync(dir)) {
      const dest = dir.startsWith('src/')
        ? path.join(outdir, dir.slice(4))
        : outdir;
      await cp(dir, dest, { recursive: true });
    }
  }
  // Surface the version from package.json into the manifest so they never drift.
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const manifestPath = path.join(outdir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.version = pkg.version;

  // Storefronts are generated rather than hand-listed. src/core/marketplaces.ts
  // is the only place they exist; see the header comment there for the five
  // places they used to live and what that cost.
  const hosts = matchPatterns();

  // Ad hosts go in host_permissions, where only the service worker can use
  // them, and deliberately NOT in content_scripts[].matches. A host in
  // `matches` means code executes on that origin, and no version of a
  // sponsorship slot needs to run on an ad server. The two lists diverge here
  // on purpose; tests/ads-packaging.test.ts pins the divergence so a future
  // edit cannot quietly collapse them back together.
  manifest.host_permissions = [...hosts, ...adMatchPatterns()];
  for (const script of manifest.content_scripts ?? []) {
    script.matches = hosts;
  }

  if (target === 'firefox') {
    // Firefox needs an explicit, stable add-on id, and a declaration of what
    // the add-on collects. `data_collection_permissions` is required for all
    // new Firefox listings; web-ext lint warns MISSING_DATA_COLLECTION_PERMISSIONS
    // without it.
    //
    // `required: ['none']` is the whole point of this product rather than a
    // formality. Firefox renders it to the user as "doesn't collect any data",
    // which is the same claim PRIVACY.md makes, now made in the place a
    // browser will repeat it. 'none' is only valid alone, which is correct
    // here: there is no second entry to add.
    //
    // The key landed in Firefox 140 (Android 142) and strict_min_version is
    // 128, so web-ext lint reports KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION.
    // That is informational and deliberate: 128 is an ESR release, the key is
    // simply ignored below 140, and AMO accepts the package with zero errors.
    // Do not "fix" the warning by raising the floor — that trades every ESR
    // user for a clean lint line.
    manifest.browser_specific_settings = {
      gecko: {
        id: 'winnow@winnow.tools',
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
    };
    // Firefox uses an event page, not a service worker, and ignores the
    // `service_worker` key while warning about it (BACKGROUND_SERVICE_WORKER_IGNORED).
    // Shipping a key the target browser ignores is noise in a review queue, so
    // the Firefox build declares only what Firefox reads.
    manifest.background = { scripts: ['background/index.js'] };
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  await copyStatic();
  console.log('[winnow] watching…');
} else {
  await esbuild.build(buildOptions);
  await copyStatic();
  console.log('[winnow] build complete → dist/');
}
