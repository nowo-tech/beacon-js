import {
  getCurrentScope,
  scrubUrl,
  type Breadcrumb,
  type Client,
  type Integration,
} from '@nowo-tech/beacon-core';

export type StatusRange = number | [number, number];

export interface HttpErrorsOptions {
  /** Statuses that create an event (default `[[500, 599]]`). */
  failedRequestStatusCodes?: StatusRange[];
  now?: () => number;
}

interface XhrInfo {
  method: string;
  url: string;
}

const XHR_INFO = '__beacon_xhr__';

function matchesStatus(status: number, ranges: StatusRange[]): boolean {
  return ranges.some((range) =>
    typeof range === 'number' ? status === range : status >= range[0] && status <= range[1],
  );
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/**
 * Wraps `fetch` and `XMLHttpRequest` (contract §7.2): every request is a breadcrumb, and network failures and
 * failed statuses become events. Requests to the Beacon host are ignored. The wrappers return exactly what the
 * originals return and never read bodies; `teardown` restores them.
 */
export function httpErrorsIntegration(options: HttpErrorsOptions = {}): Integration {
  const ranges = options.failedRequestStatusCodes ?? [[500, 599]];
  const now = options.now ?? Date.now;
  let restore: (() => void) | undefined;
  return {
    name: 'HttpErrors',
    setup(client: Client) {
      const dsn = client.dsn!;
      const beaconOrigin = `${dsn.protocol}://${dsn.host}`;
      const isBeacon = (url: string): boolean => {
        try {
          return new URL(url, location.href).origin === new URL(beaconOrigin).origin;
        } catch {
          return false;
        }
      };
      const record = (
        category: 'fetch' | 'xhr',
        method: string,
        url: string,
        start: number,
        status?: number,
      ): void => {
        const safeUrl = scrubUrl(url);
        const data: Record<string, unknown> = { method, url: safeUrl, duration: now() - start };
        if (status !== undefined) data['status_code'] = status;
        const crumb: Breadcrumb = {
          category,
          type: 'http',
          data,
          level:
            status === undefined || status >= 500 ? 'error' : status >= 400 ? 'warning' : 'info',
        };
        client.addBreadcrumb(crumb, getCurrentScope());
        if (status === undefined || matchesStatus(status, ranges)) {
          const message =
            status === undefined
              ? `${method} ${safeUrl} failed (network error)`
              : `${method} ${safeUrl} responded ${status}`;
          client.captureException(
            { name: 'HttpError', message },
            getCurrentScope(),
            { extra: data },
            { mechanism: { type: 'instrument', handled: true }, logger: category },
          );
        }
      };

      const originalFetch = globalThis.fetch;
      const wrappedFetch = function (
        this: unknown,
        ...args: [RequestInfo | URL, RequestInit?]
      ): Promise<Response> {
        const result = originalFetch.apply(this, args);
        const [input, init] = args;
        const url = requestUrl(input);
        if (!isBeacon(url)) {
          const method = (
            init?.method ?? (input instanceof Request ? input.method : 'GET')
          ).toUpperCase();
          const start = now();
          result.then(
            (response) => record('fetch', method, url, start, response.status),
            () => record('fetch', method, url, start),
          );
        }
        return result;
      };
      globalThis.fetch = wrappedFetch;

      const proto = XMLHttpRequest.prototype;
      const originalOpen = proto.open;
      const originalSend = proto.send;
      proto.open = function (
        this: XMLHttpRequest & { [XHR_INFO]?: XhrInfo },
        ...args: Parameters<typeof originalOpen>
      ) {
        this[XHR_INFO] = { method: String(args[0]).toUpperCase(), url: String(args[1]) };
        return originalOpen.apply(this, args);
      } as typeof originalOpen;
      proto.send = function (
        this: XMLHttpRequest & { [XHR_INFO]?: XhrInfo },
        ...args: Parameters<typeof originalSend>
      ) {
        const info = this[XHR_INFO];
        if (info && !isBeacon(info.url)) {
          const start = now();
          this.addEventListener('loadend', () =>
            record('xhr', info.method, info.url, start, this.status || undefined),
          );
        }
        return originalSend.apply(this, args);
      };

      restore = () => {
        if (globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch;
        proto.open = originalOpen;
        proto.send = originalSend;
      };
    },
    teardown() {
      restore?.();
    },
  };
}
