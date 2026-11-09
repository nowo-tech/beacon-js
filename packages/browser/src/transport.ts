import { makeFetchTransport, type Compressor, type Transport } from '@nowo-tech/beacon-core';

export const BROWSER_CONTENT_TYPE = 'text/plain;charset=UTF-8';
/** Browsers allow 64 kB in total for in-flight keepalive requests. */
export const KEEPALIVE_MAX_BYTES = 60_000;
/** With `compression: 'auto'`, bodies over 32 kB are gzipped when `CompressionStream` exists (contract §3.1 rule 8). */
export const COMPRESS_MIN_BYTES = 32_768;

/** gzip with `CompressionStream`, or `undefined` when the browser has none. */
export const compressionStreamGzip: Compressor = async (body) => {
  if (typeof CompressionStream === 'undefined') return undefined;
  const stream = new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

export interface BrowserTransportOptions {
  /** `false` (default) sends uncompressed; `'auto'` gzips over 32 kB and requires Beacon ≥ 1.143. */
  compression?: 'auto' | false;
  /** The un-instrumented `fetch` (captured before `HttpErrors` wraps it). */
  fetch?: typeof fetch;
}

/**
 * The browser transport (contract §4.2): `text/plain` simple requests with `credentials: 'omit'`, `keepalive` up to
 * 60 kB, `sendBeacon` on unload, opt-in gzip over 32 kB (never on unload), and a 60 s wait after an opaque failure.
 */
export function makeBrowserTransport(options: BrowserTransportOptions = {}): Transport {
  return makeFetchTransport({
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    contentType: BROWSER_CONTENT_TYPE,
    timeoutMs: 10_000,
    keepaliveMaxBytes: KEEPALIVE_MAX_BYTES,
    fetchInit: { credentials: 'omit', mode: 'cors', referrerPolicy: 'strict-origin' },
    ...(options.compression === 'auto' ? { compress: compressionStreamGzip } : {}),
    compressMinBytes: COMPRESS_MIN_BYTES,
    networkRetryMs: 60_000,
    ...(navigator.sendBeacon
      ? {
          sendBeacon: (url: string, body: string, type: string) =>
            navigator.sendBeacon(url, new Blob([body], { type })),
        }
      : {}),
  });
}
