import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

describe('gzipCompressor', () => {
  it('gzips at level 6', async () => {
    const { gzipCompressor } = await import('../src/gzip.js');
    const out = await gzipCompressor('hello hello');
    expect(gunzipSync(out!).toString()).toBe('hello hello');
  });

  it('resolves undefined when zlib fails', async () => {
    vi.resetModules();
    vi.doMock('node:zlib', () => ({
      gzip: (_body: string, _options: unknown, callback: (error: Error | null) => void) =>
        callback(new Error('zlib')),
    }));
    const { gzipCompressor } = await import('../src/gzip.js');
    expect(await gzipCompressor('x')).toBeUndefined();
    vi.doUnmock('node:zlib');
  });
});
