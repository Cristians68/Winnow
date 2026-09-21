import { defineConfig } from 'vitest/config';

/**
 * The server's own test config.
 *
 * It exists to stop vitest walking up and finding the one at the repository
 * root. The server is a separate npm package with its own dependencies, and
 * CI installs them separately — so when `npm test` ran here and picked up the
 * root config, it tried to resolve `vitest/config` against the root's
 * node_modules, which that job never installed. It failed at startup with
 * ERR_MODULE_NOT_FOUND before running a single test.
 *
 * It passed locally, of course: a developer machine has both trees installed,
 * so the upward search finds a config that happens to resolve. That gap
 * between "works here" and "works in CI" is the whole reason this file is
 * explicit rather than inherited.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
  },
});
