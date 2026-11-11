import {
  DEFAULT_RETRY_AFTER_MS,
  parseRetryAfter,
  parseSentryRateLimits,
  QUOTA_MIN_MS,
} from './ratelimit.js';
import type { Category } from './types.js';
import { byteLength } from './utils.js';

export interface TransportRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  category: Category;
  eventId?: string;
  /** The page is going away. */
  unload?: boolean;
}

export type TransportResult =
  | { kind: 'ok' }
  | {
      kind: 'retry';
      afterMs: number;
      reason: 'ratelimit' | 'quota' | 'unavailable' | 'network';
      /** `X-Beacon-Rate-Limit` (`ip|key|project|quota`), when Beacon sent it. */
      rateLimit?: string;
      /** HTTP status, when there was a response. */
      status?: number;
      /** The request was aborted by the transport's own timeout (it may still have reached Beacon). */
      timedOut?: boolean;
    }
  | {
      kind: 'drop';
      reason: 'unauthorized' | 'forbidden' | 'too_large' | 'invalid' | 'client';
      status?: number;
    };

export interface Transport {
  send(request: TransportRequest): Promise<TransportResult>;
  /** Resolves `true` when every in-flight request settled within the timeout. */
  flush(timeoutMs: number): Promise<boolean>;
}

/** Compresses a body; resolves `undefined` when compression is not available. */
export type Compressor = (body: string) => Promise<Uint8Array | undefined>;

/** Beacon refuses a decompression ratio above 50:1 with `413`. */
export const MAX_COMPRESSION_RATIO = 50;

/**
 * Gzips `body` when it is over `minBytes` and the ratio stays within 50:1 (contract §3.1 rule 8). Otherwise returns
 * the body unchanged, with no encoding.
 */
export async function maybeCompress(
  body: string,
  compress: Compressor | undefined,
  minBytes: number,
): Promise<{ body: string | Uint8Array; encoding?: 'gzip' }> {
  const size = byteLength(body);
  if (!compress || size <= minBytes) return { body };
  const compressed = await compress(body).catch(() => undefined);
  if (!compressed || size / compressed.byteLength > MAX_COMPRESSION_RATIO) return { body };
  return { body: compressed, encoding: 'gzip' };
}

/** Maps an HTTP response to a transport result (contract §4.3). */
export function classifyResponse(
  status: number,
  header: (name: string) => string | null,
  nowMs: number,
): TransportResult {
  if (status >= 200 && status < 300) return { kind: 'ok' };
  if (status === 429) {
    const rateLimit = header('x-beacon-rate-limit') ?? undefined;
    let afterMs = parseRetryAfter(header('retry-after'), nowMs) ?? DEFAULT_RETRY_AFTER_MS;
    afterMs = Math.max(afterMs, parseSentryRateLimits(header('x-sentry-rate-limits')) ?? 0);
    const quota = rateLimit === 'quota';
    if (quota) afterMs = Math.max(afterMs, QUOTA_MIN_MS);
    const result: TransportResult = {
      kind: 'retry',
      afterMs,
      reason: quota ? 'quota' : 'ratelimit',
      status,
    };
    if (rateLimit) result.rateLimit = rateLimit;
    return result;
  }
  if (status >= 500) {
    const afterMs = status === 503 ? (parseRetryAfter(header('retry-after'), nowMs) ?? 0) : 0;
    return { kind: 'retry', afterMs, reason: 'unavailable', status };
  }
  const reasons: Record<number, 'unauthorized' | 'forbidden' | 'too_large' | 'invalid'> = {
    400: 'invalid',
    401: 'unauthorized',
    403: 'forbidden',
    413: 'too_large',
  };
  return { kind: 'drop', reason: reasons[status] ?? 'client', status };
}

export interface FetchTransportOptions {
  /** Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Request timeout (default 10 s). */
  timeoutMs?: number;
  /** Extra `fetch` init (`credentials`, `mode`, `referrerPolicy`, …). */
  fetchInit?: RequestInit;
  /** `Content-Type` of the body. */
  contentType?: string;
  /** Use `keepalive` while the body is at most this many bytes (0 disables it). */
  keepaliveMaxBytes?: number;
  compress?: Compressor;
  /** Bodies at or below this size are never compressed. */
  compressMinBytes?: number;
  /** Never compress requests made while the page unloads. */
  compressOnUnload?: boolean;
  /** Wait after a network error (the browser uses 60 s for opaque failures). */
  networkRetryMs?: number;
  /** `navigator.sendBeacon`; used for unload requests without custom headers. */
  sendBeacon?: (url: string, body: string, contentType: string) => boolean;
  now?: () => number;
}

/** The default transport (browser and Node ≥ 20 `fetch`). */
export function makeFetchTransport(options: FetchTransportOptions = {}): Transport {
  const inFlight = new Set<Promise<unknown>>();
  const contentType = options.contentType ?? 'application/x-beacon-envelope';
  const now = options.now ?? Date.now;

  const send = async (request: TransportRequest): Promise<TransportResult> => {
    if (request.unload && options.sendBeacon && Object.keys(request.headers).length === 0) {
      return options.sendBeacon(request.url, request.body, contentType)
        ? { kind: 'ok' }
        : { kind: 'retry', afterMs: 0, reason: 'unavailable' };
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const allowCompression = !request.unload || options.compressOnUnload === true;
    const payload = await maybeCompress(
      request.body,
      allowCompression ? options.compress : undefined,
      options.compressMinBytes ?? 1024,
    );
    const headers: Record<string, string> = { 'Content-Type': contentType, ...request.headers };
    if (payload.encoding) headers['Content-Encoding'] = payload.encoding;
    const size =
      typeof payload.body === 'string' ? byteLength(payload.body) : payload.body.byteLength;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
    try {
      const response = await fetchImpl(request.url, {
        ...options.fetchInit,
        method: 'POST',
        headers,
        body: payload.body as BodyInit,
        keepalive: size <= (options.keepaliveMaxBytes ?? 0),
        signal: controller.signal,
        // Never follow a redirect: Node's fetch would replay `X-Beacon-Auth` (the DSN secret) and the body to the
        // target host (audit LO-M2). A 3xx, or the browser's `opaqueredirect`, is a failed send that is never re-sent.
        redirect: 'manual',
      });
      if (response.type === 'opaqueredirect') return { kind: 'drop', reason: 'client' };
      return classifyResponse(response.status, (name) => response.headers.get(name), now());
    } catch {
      const failure: Extract<TransportResult, { kind: 'retry' }> = {
        kind: 'retry',
        afterMs: options.networkRetryMs ?? 0,
        reason: 'network',
      };
      if (controller.signal.aborted) failure.timedOut = true;
      return failure;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    send(request) {
      const promise = send(request);
      inFlight.add(promise);
      void promise.finally(() => inFlight.delete(promise));
      return promise;
    },
    async flush(timeoutMs) {
      if (!inFlight.size) return true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      });
      const drained = Promise.allSettled([...inFlight]).then(() => true);
      const result = await Promise.race([drained, timeout]);
      clearTimeout(timer);
      return result;
    },
  };
}
