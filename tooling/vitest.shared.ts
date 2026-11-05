import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ViteUserConfig } from 'vitest/config';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Workspace packages resolve to their sources in tests, so no build is needed and coverage maps to `src/`. */
export const alias = {
  '@nowo-tech/beacon-core': `${root}packages/core/src/index.ts`,
  '@nowo-tech/beacon-browser': `${root}packages/browser/src/index.ts`,
  '@nowo-tech/beacon-node': `${root}packages/node/src/index.ts`,
};

export function sharedConfig(packageDir: string): ViteUserConfig {
  const pkg = JSON.parse(readFileSync(`${packageDir}/package.json`, 'utf8')) as { version: string };
  return {
    define: { __BEACON_VERSION__: JSON.stringify(pkg.version) },
    resolve: { alias },
    test: {
      include: ['test/**/*.test.ts'],
      restoreMocks: true,
      unstubGlobals: true,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/types.ts'],
        reporter: ['text', 'json-summary', 'lcov'],
        thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  };
}
