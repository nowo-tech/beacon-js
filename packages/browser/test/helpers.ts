import { vi } from 'vitest';

export const DSN =
  'https://bk_test_0000000000000000@beacon.test/00000000-0000-4000-8000-000000000001';
export const ENVELOPE_URL =
  'https://beacon.test/api/ingest/v1/00000000-0000-4000-8000-000000000001/envelope/';

export interface Sent {
  url: string;
  init: RequestInit;
  body: string;
}

/** Stubs `fetch` before `init` (the transport keeps the original), answering `status` and recording bodies. */
export function stubFetch(status = 200, headers: Record<string, string> = {}) {
  const sent: Sent[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://beacon.test')) sent.push({ url, init, body: String(init.body) });
    return Promise.resolve(new Response(null, { status, headers }));
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, sent };
}

export function events(sent: Sent[]): Array<Record<string, any>> {
  return sent
    .map((request) => request.body.split('\n'))
    .filter((lines) => JSON.parse(lines[1]!).type === 'event')
    .map((lines) => JSON.parse(lines[2]!) as Record<string, any>);
}

export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
