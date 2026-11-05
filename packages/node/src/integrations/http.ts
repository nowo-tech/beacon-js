import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import {
  addBreadcrumb,
  scrubUrl,
  type Client,
  type Integration,
  type ParsedDsn,
} from '@nowo-tech/beacon-core';

interface Pending {
  method: string;
  url: string;
  start: number;
  category: 'http' | 'fetch';
}

interface ClientRequestLike {
  getHeader?: (name: string) => unknown;
  method?: string;
  protocol?: string;
  host?: string;
  path?: string;
}

interface UndiciRequestLike {
  method?: string;
  origin?: string | URL;
  path?: string;
}

/**
 * Breadcrumbs for outgoing `http`, `https` and `fetch` requests through `diagnostics_channel` (contract §8.1):
 * method, scrubbed URL, status and duration. Requests to the Beacon host are excluded. Bodies are never read.
 */
export function httpIntegration(now: () => number = Date.now): Integration {
  const pending = new WeakMap<object, Pending>();
  const subscriptions: Array<[string, (message: unknown) => void]> = [];
  return {
    name: 'Http',
    setup(client: Client) {
      const beaconHost = (client.dsn as ParsedDsn).host;
      const start = (
        key: object,
        method: string | undefined,
        url: string,
        category: Pending['category'],
      ): void => {
        let host = '';
        try {
          host = new URL(url).host;
        } catch {
          // a relative or broken URL is still recorded
        }
        if (host === beaconHost) return;
        pending.set(key, {
          method: (method ?? 'GET').toUpperCase(),
          url: scrubUrl(url),
          start: now(),
          category,
        });
      };
      const finish = (key: object, status: number | undefined): void => {
        const request = pending.get(key);
        if (!request) return;
        pending.delete(key);
        const data: Record<string, unknown> = {
          method: request.method,
          url: request.url,
          duration_ms: now() - request.start,
        };
        if (status !== undefined) data['status_code'] = status;
        addBreadcrumb({
          type: 'http',
          category: request.category,
          level:
            status === undefined || status >= 500 ? 'error' : status >= 400 ? 'warning' : 'info',
          data,
        });
      };
      const on = <T>(channel: string, fn: (message: T) => void): void => {
        const listener = fn as (message: unknown) => void;
        subscribe(channel, listener);
        subscriptions.push([channel, listener]);
      };
      on('http.client.request.start', ({ request }: { request: ClientRequestLike }) => {
        const host = (request.getHeader?.('host') as string | undefined) ?? request.host ?? '';
        start(
          request,
          request.method,
          `${request.protocol ?? 'http:'}//${host}${request.path ?? ''}`,
          'http',
        );
      });
      on(
        'http.client.response.finish',
        ({ request, response }: { request: object; response?: { statusCode?: number } }) => {
          finish(request, response?.statusCode);
        },
      );
      on('http.client.request.error', ({ request }: { request: object }) =>
        finish(request, undefined),
      );
      on('undici:request:create', ({ request }: { request: UndiciRequestLike }) => {
        start(
          request,
          request.method,
          `${String(request.origin ?? '')}${request.path ?? ''}`,
          'fetch',
        );
      });
      on(
        'undici:request:headers',
        ({ request, response }: { request: object; response?: { statusCode?: number } }) => {
          finish(request, response?.statusCode);
        },
      );
      on('undici:request:error', ({ request }: { request: object }) => finish(request, undefined));
    },
    teardown() {
      for (const [channel, fn] of subscriptions.splice(0)) unsubscribe(channel, fn);
    },
  };
}
