import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { sharedConfig } from '../../tooling/vitest.shared.ts';

const shared = sharedConfig(import.meta.dirname);

// Browser-only code paths (sendBeacon, IndexedDB, CompressionStream, custom elements, history) run in a real
// Chromium through Vitest browser mode, so that v8 coverage measures them (contract §2.2, §10.4).
export default defineConfig({
  ...shared,
  test: {
    ...shared.test,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
