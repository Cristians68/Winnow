/**
 * Regenerate the frozen expected results for every corpus fixture.
 *
 *   npm run corpus:freeze
 *
 * This accepts whatever the code currently does. That is the point and also the
 * hazard: running it turns a failing case green without anyone deciding the new
 * behaviour is correct. **Read the diff.** A grade that moved and cannot be
 * explained by the change you just made is the corpus reporting a regression,
 * not a stale file needing a refresh.
 *
 * Runs the same projection the test does, from the same module, so the two
 * cannot drift apart.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_DIR = join(ROOT, 'tests', 'corpus');

/** The engine is TypeScript; bundle it to a temp ESM file so node can import it. */
async function loadEngine() {
  const dir = mkdtempSync(join(tmpdir(), 'winnow-freeze-'));
  const outfile = join(dir, 'engine.mjs');

  await build({
    entryPoints: [join(ROOT, 'tools', 'corpus-entry.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile,
    logLevel: 'silent',
  });

  const mod = await import(pathToFileURL(outfile).href);
  return { mod, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const { mod, cleanup } = await loadEngine();
const { project, captureMetaFrom } = await import(pathToFileURL(join(CORPUS_DIR, 'project.mjs')).href);

const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.html')).sort();

if (files.length === 0) {
  console.error('No .html fixtures found in tests/corpus. Nothing to freeze.');
  process.exit(1);
}

const realNow = Date.now;
let written = 0;

for (const file of files) {
  const html = readFileSync(join(CORPUS_DIR, file), 'utf8');

  const window = new Window();
  window.document.write(html);
  const doc = window.document;

  const { url, capturedAt } = captureMetaFrom(doc);

  // Same clock pinning as the test — see tests/corpus.test.ts for why.
  const frozen = new Date(capturedAt).getTime();
  Date.now = () => frozen;

  try {
    const snapshot = mod.buildSnapshot(doc, url);
    if (!snapshot) throw new Error('buildSnapshot returned null');

    const result = project(snapshot, mod.analyse(snapshot));
    const out = join(CORPUS_DIR, file.replace(/\.html$/, '.expected.json'));
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

    console.log(
      `froze ${file} -> grade ${result.analysis.grade}, ` +
        `trust ${result.analysis.trustScore}, ${result.snapshot.reviewCount} reviews`,
    );
    written++;
  } finally {
    Date.now = realNow;
    await window.happyDOM?.close?.();
  }
}

cleanup();
console.log(`\n${written} case(s) frozen. Read the diff before committing.`);
