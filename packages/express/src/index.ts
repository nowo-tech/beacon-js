import {
  getClient,
  getCurrentScope,
  IP_HEADERS,
  normalize,
  scrubUrl,
  withScope,
  type RequestData,
} from '@nowo-tech/beacon-node';
import type { ErrorRequestHandler, Request, RequestHandler } from 'express';

export interface RequestHandlerOptions {
  /** Attach `req.body` (scrubbed, at most 10 kB). Default false. */
  includeBody?: boolean;
}

export interface ErrorHandlerOptions {
  /** Default: errors without a status, and statuses of 500 or more. */
  shouldHandleError?: (error: unknown) => boolean;
}

const MAX_BODY_BYTES = 10 * 1024;
const PII_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

function headersOf(req: Request, sendDefaultPii: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (value === undefined || IP_HEADERS.includes(lower)) continue;
    if (!sendDefaultPii && PII_HEADERS.includes(lower)) continue;
    out[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

function bodyOf(body: unknown): unknown {
  if (body === undefined) return undefined;
  const value = normalize(body, {
    depth: 5,
    maxKeys: 100,
    maxArray: 100,
    maxString: MAX_BODY_BYTES,
  });
  const json = JSON.stringify(value);
  return json.length > MAX_BODY_BYTES ? `${json.slice(0, MAX_BODY_BYTES - 1)}…` : value;
}

/** Request data for the event (contract §8.2): method, scrubbed URL, scrubbed headers, never cookies by default. */
export function requestDataOf(req: Request, options: RequestHandlerOptions = {}): RequestData {
  const sendDefaultPii = getClient()?.options.sendDefaultPii === true;
  const data: RequestData = {
    method: req.method,
    url: scrubUrl(`${req.protocol}://${req.get('host') ?? 'localhost'}${req.originalUrl}`),
    headers: headersOf(req, sendDefaultPii),
  };
  if (options.includeBody) {
    const body = bodyOf(req.body as unknown);
    if (body !== undefined) data.data = body;
  }
  return data;
}

/** Install first: an isolated scope per request, with the request context. */
export function beaconRequestHandler(options: RequestHandlerOptions = {}): RequestHandler {
  return function beaconRequestHandler(req, _res, next) {
    withScope((scope) => {
      scope.request = requestDataOf(req, options);
      next();
    });
  };
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    output?: { statusCode?: unknown };
  };
  const status = candidate.status ?? candidate.statusCode ?? candidate.output?.statusCode;
  const number = Number(status);
  return status === undefined || !Number.isFinite(number) ? undefined : number;
}

/** The default filter: errors without a status, and statuses of 500 or more. */
export function defaultShouldHandleError(error: unknown): boolean {
  const status = statusOf(error);
  return status === undefined || status >= 500;
}

/**
 * Install after the routes: captures the error (mechanism `express`, unhandled) with the route, then calls
 * `next(err)` so that Express (or the app's own error handler) still answers. Works with Express 4 and 5.
 */
export function beaconErrorHandler(options: ErrorHandlerOptions = {}): ErrorRequestHandler {
  const shouldHandle = options.shouldHandleError ?? defaultShouldHandleError;
  return function beaconErrorHandler(error, req, res, next) {
    const client = getClient();
    if (client && shouldHandle(error)) {
      const scope = getCurrentScope().clone();
      const request = { ...(scope.request ?? requestDataOf(req)) };
      const route = (req.route as { path?: unknown } | undefined)?.path;
      if (typeof route === 'string') {
        request['route'] = route;
        scope.setTag('route', `${req.method} ${route}`);
      }
      scope.request = request;
      const eventId = client.captureException(error, scope, undefined, {
        mechanism: { type: 'express', handled: false },
        logger: 'express',
      });
      (res.locals as Record<string, unknown>)['beaconEventId'] = eventId;
    }
    next(error);
  };
}
