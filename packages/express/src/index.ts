import {
  getClient,
  getCurrentScope,
  maskCredentials,
  normalize,
  scrubObject,
  scrubUrl,
  withScope,
  type RequestData,
} from '@nowo-tech/beacon-node';
import type { ErrorRequestHandler, Request, RequestHandler } from 'express';

export interface RequestHandlerOptions {
  /** Attach `req.body` (keys scrubbed; dropped when unparsable or over 10 kB). Default false. */
  includeBody?: boolean;
  /**
   * Extra request headers to record, on top of the default allow-list. Client-address, cookie and authorization
   * headers are never recorded, even when listed here.
   */
  allowHeaders?: string[];
}

export interface ErrorHandlerOptions {
  /** Default: errors without a status, and statuses of 500 or more. */
  shouldHandleError?: (error: unknown) => boolean;
}

const MAX_BODY_BYTES = 10 * 1024;

/** The request headers recorded by default (contract §5, allow-list). */
export const DEFAULT_ALLOWED_HEADERS: readonly string[] = [
  'accept',
  'accept-encoding',
  'accept-language',
  'content-length',
  'content-type',
  'referer',
  'user-agent',
];

/** Never recorded, whatever the allow-list says: client addresses, cookies and credentials. */
const NEVER_HEADERS =
  /forwarded|client-?ip|real-?ip|(?:^|-)ip(?:v[46])?$|^cf-|^fastly-|^x-vercel-|external-address|true-client|cookie|authorization|^x-beacon-auth$|api-?key|token|secret/i;

export const BODY_TRUNCATED = '[truncated]';
export const BODY_UNPARSED = '[unparsed]';

function headersOf(req: Request, allowHeaders: readonly string[]): Record<string, string> {
  const allowed = new Set([
    ...DEFAULT_ALLOWED_HEADERS,
    ...allowHeaders.map((name) => name.toLowerCase()),
  ]);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (value === undefined || !allowed.has(lower) || NEVER_HEADERS.test(lower)) continue;
    const text = Array.isArray(value) ? value.join(', ') : value;
    // The referer is another page's URL: its query string and fragment are never kept.
    out[name] = lower === 'referer' ? scrubUrl(text).replace(/\?.*$/, '') : text;
  }
  return out;
}

/** Parses JSON and form bodies that arrive as text, so that their keys can be scrubbed. */
function parsedBody(body: unknown, contentType: string): unknown {
  if (typeof body !== 'string' && !(body instanceof Uint8Array)) return body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  if (/json/i.test(contentType)) return JSON.parse(text) as unknown;
  if (/x-www-form-urlencoded/i.test(contentType))
    return Object.fromEntries(new URLSearchParams(text));
  throw new Error('unsupported body');
}

/**
 * The request body for the event (FV-M1): parsed, keys scrubbed **before** anything is cut, string values
 * credential-masked, and then either kept whole (≤ 10 kB) or replaced by `[truncated]`. Raw text is never sent:
 * a body that cannot be parsed becomes `[unparsed]`.
 */
export function bodyOf(body: unknown, contentType = ''): unknown {
  if (body === undefined) return undefined;
  let value: unknown;
  try {
    value = parsedBody(body, contentType);
  } catch {
    return BODY_UNPARSED;
  }
  const scrubbed = maskValues(scrubObject(value, 20));
  const normalized = normalize(scrubbed, {
    depth: 5,
    maxKeys: 100,
    maxArray: 100,
    maxString: MAX_BODY_BYTES,
  });
  return JSON.stringify(normalized).length > MAX_BODY_BYTES ? BODY_TRUNCATED : normalized;
}

function maskValues(value: unknown): unknown {
  if (typeof value === 'string') return maskCredentials(value);
  if (Array.isArray(value)) return value.map(maskValues);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskValues(item)]));
  }
  return value;
}

/** Request data for the event (contract §8.2): method, scrubbed URL, allow-listed headers, never cookies. */
export function requestDataOf(req: Request, options: RequestHandlerOptions = {}): RequestData {
  const data: RequestData = {
    method: req.method,
    url: scrubUrl(`${req.protocol}://${req.get('host') ?? 'localhost'}${req.originalUrl}`),
    headers: headersOf(req, options.allowHeaders ?? []),
  };
  if (options.includeBody) {
    const body = bodyOf(req.body as unknown, String(req.get('content-type') ?? ''));
    if (body !== undefined) data.data = body;
  }
  return data;
}

/** Install first: an isolated scope per request, with the request context. */
export function beaconRequestHandler(options: RequestHandlerOptions = {}): RequestHandler {
  return function beaconRequestHandler(req, _res, next) {
    let request: RequestData | undefined;
    try {
      request = requestDataOf(req, options);
    } catch {
      // The SDK never changes the app's behaviour: without request data, the request still goes on.
      request = undefined;
    }
    withScope((scope) => {
      if (request) scope.request = request;
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
    try {
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
    } catch {
      // Whatever happens in the SDK, the app's own error goes on unchanged.
    }
    next(error);
  };
}
