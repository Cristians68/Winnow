import * as esbuild from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

/** Entry points that become their own bundles in the extension. */
const entryPoints = {
  'content/index': 'src/content/index.ts',
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
