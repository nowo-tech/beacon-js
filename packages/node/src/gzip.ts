import { gzip } from 'node:zlib';
import type { Compressor } from '@nowo-tech/beacon-core';

/** Gzip (level 6) with `node:zlib`. Resolves `undefined` on failure, so the body is sent uncompressed. */
export const gzipCompressor: Compressor = (body) =>
  new Promise((resolve) => {
    gzip(body, { level: 6 }, (error, buffer) => {
      resolve(
        error ? undefined : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      );
    });
  });
