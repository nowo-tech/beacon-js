import { defineConfig } from 'vitest/config';
import { sharedConfig } from '../../tooling/vitest.shared.ts';

export default defineConfig(sharedConfig(import.meta.dirname));
