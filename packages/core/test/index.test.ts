import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';

describe('public API', () => {
  it('exports the documented surface and the package version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(core.SDK_VERSION).toBe(pkg.version);
    for (const name of [
      'initClient',
      'captureException',
      'captureMessage',
      'capture',
      'withScope',
      'makeFetchTransport',
      'defaultDsnParser',
      'beaconServerAuth',
      'envelopeDsnAuth',
      'headerBrowserKeyAuth',
      'serverEnvelopeDsnAuth',
      'encodeEnvelope',
      'Client',
      'Scope',
    ]) {
      expect(core).toHaveProperty(name);
    }
  });
});
