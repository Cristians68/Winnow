/**
 * Produce store upload zips from clean builds, one per browser target.
 *
 * Verifies each packaged manifest before zipping — a listing rejected for a
 * stray permission costs days of review turnaround, so it is worth failing
 * loudly here instead.
 *
 * Every check runs against every target. A guard that inspects one build and
 * waves the other through is a guard with a hole in it, and the hole would sit
 * exactly where the two manifests differ, which is the only place a divergence
 * could hide.
 */
import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isKnownAmazonHost } from './src/core/marketplaces.ts';

const EXPECTED_PERMISSIONS = ['storage'];
const TARGETS = ['chrome', 'firefox'];

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const packaged = [];

for (const target of TARGETS) {
  const outFile = path.resolve(`winnow-${pkg.version}-${target}.zip`);

  // 1. Clean build for this target.
  execFileSync(process.execPath, ['build.mjs', `--target=${target}`], { stdio: 'inherit' });

  // 2. Sanity-check the packaged manifest.
  const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
  const problems = [];

  if (manifest.version !== pkg.version) {
    problems.push(`manifest version ${manifest.version} != package version ${pkg.version}`);
  }

  const extra = (manifest.permissions ?? []).filter((p) => !EXPECTED_PERMISSIONS.includes(p));
  if (extra.length > 0) {
    problems.push(`unexpected permissions: ${extra.join(', ')} (minimal permissions are a product promise)`);
  }

  // Amazon storefronts and nothing else. The shipped build reaches no server at
  // all: grading is local, and deep analysis is only reachable via the loopback
  // dev endpoint below. If a hosted endpoint is ever added it must be added here
  // deliberately, because the privacy policy tells users exactly which hosts this
  // extension can reach.
  // Exact match against the registry, not a substring test. The previous guard
  // was `/amazon\./` unanchored, which passes `*://*.amazon.evil.com/*` — a hole
  // in the one check standing between this build and a host the privacy policy
  // does not disclose.
  const strayHosts = (manifest.host_permissions ?? []).filter((h) => !isKnownAmazonHost(h));
  if (strayHosts.length > 0) {
    problems.push(`unexpected host_permissions: ${strayHosts.join(', ')}`);
  }

  // Content scripts are a second grant of the same reach and must agree.
  for (const script of manifest.content_scripts ?? []) {
    const strayMatches = (script.matches ?? []).filter((h) => !isKnownAmazonHost(h));
    if (strayMatches.length > 0) {
      problems.push(`unexpected content_script matches: ${strayMatches.join(', ')}`);
    }
  }

  // Optional hosts exist only for the local dev server and must stay loopback.
  const strayOptional = (manifest.optional_host_permissions ?? []).filter(
    (h) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/\*$/.test(h),
  );
  if (strayOptional.length > 0) {
    problems.push(`optional_host_permissions must be loopback only, found: ${strayOptional.join(', ')}`);
  }

  const requiredFiles = [
    'dist/manifest.json',
    'dist/content/index.js',
    'dist/content/serp.js',
    'dist/popup/ui/popup.html',
    'dist/options/ui/options.html',
    'dist/icons/icon128.png',
  ];
  for (const required of requiredFiles) {
    if (!existsSync(required)) problems.push(`missing ${required}`);
  }

  // Every file the manifest points at has to exist. Listing them by hand above
  // catches the ones we remember; this catches the ones we add later and forget,
  // which is the failure mode that actually happens.
  const declared = [
    ...(manifest.content_scripts ?? []).flatMap((s) => s.js ?? []),
    ...(manifest.background?.scripts ?? []),
    ...(manifest.background?.service_worker ? [manifest.background.service_worker] : []),
  ];
  for (const file of declared) {
    if (!existsSync(path.join('dist', file))) {
      problems.push(`manifest declares ${file}, which the build did not produce`);
    }
  }

  if (target === 'firefox' && !manifest.browser_specific_settings?.gecko?.id) {
    problems.push('firefox build is missing browser_specific_settings.gecko.id');
  }

  if (problems.length > 0) {
    console.error(`\n[winnow] packaging aborted (${target}):`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    process.exit(1);
  }

  // 3. Zip it.
  await rm(outFile, { force: true });
  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Compress-Archive -Path 'dist/*' -DestinationPath '${outFile}' -Force`],
      { stdio: 'inherit' },
    );
  } else {
    execFileSync('zip', ['-r', outFile, '.'], { cwd: 'dist', stdio: 'inherit' });
  }

  packaged.push({ target, name: path.basename(outFile), permissions: (manifest.permissions ?? []).join(', ') });
}

// Leave dist/ holding the Chrome build — what load-unpacked and every test
// expects to find there.
execFileSync(process.execPath, ['build.mjs'], { stdio: 'inherit' });

console.log('');
for (const { target, name, permissions } of packaged) {
  console.log(`[winnow] packaged ${target} → ${name} (permissions: ${permissions})`);
}
