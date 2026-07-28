/**
 * Produce a Chrome Web Store upload zip from a clean build.
 *
 * Verifies the packaged manifest before zipping — a listing rejected for a
 * stray permission costs days of review turnaround, so it is worth failing
 * loudly here instead.
 */
import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const EXPECTED_PERMISSIONS = ['storage'];

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const outFile = path.resolve(`winnow-${pkg.version}.zip`);

// 1. Clean build.
execFileSync(process.execPath, ['build.mjs'], { stdio: 'inherit' });

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
const ALLOWED_HOSTS = [/amazon\./];
const strayHosts = (manifest.host_permissions ?? []).filter(
  (h) => !ALLOWED_HOSTS.some((pattern) => pattern.test(h)),
);
if (strayHosts.length > 0) {
  problems.push(`unexpected host_permissions: ${strayHosts.join(', ')}`);
}

// Optional hosts exist only for the local dev server and must stay loopback.
const strayOptional = (manifest.optional_host_permissions ?? []).filter(
  (h) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/\*$/.test(h),
);
if (strayOptional.length > 0) {
  problems.push(`optional_host_permissions must be loopback only, found: ${strayOptional.join(', ')}`);
}

for (const required of ['dist/manifest.json', 'dist/content/index.js', 'dist/popup/ui/popup.html', 'dist/options/ui/options.html', 'dist/icons/icon128.png']) {
  if (!existsSync(required)) problems.push(`missing ${required}`);
}

if (problems.length > 0) {
  console.error('\n[winnow] packaging aborted:');
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

console.log(`\n[winnow] packaged → ${path.basename(outFile)}`);
console.log(`[winnow] permissions: ${(manifest.permissions ?? []).join(', ')}`);
