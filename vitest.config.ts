import { defineConfig } from 'vitest/config';

/**
 * Test discovery.
 *
 * The exclusions matter more than they look. Agent tooling creates git
 * worktrees under `.claude/worktrees/<branch>/`, and a worktree is a full
 * second copy of this repository — including its own `tests/`. Vitest walks
 * the project directory, so those copies were being collected and run
 * alongside the real suite.
 *
 * That is worse than noisy. A worktree's tests assert against *its own*
 * checkout, so a run reported failures for files that were never edited here,
 * and `npm test` counted a different number of tests depending on whether a
 * worktree happened to exist. A suite whose result depends on unrelated
 * checked-out branches cannot be used to decide whether to ship.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'server/tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Agent worktrees: a whole second copy of this repo, tests included.
      '.claude/**',
      // Per-suite build output; see the note in tests/manifest.test.ts.
      '.tmp-test/**',
    ],
  },
});
