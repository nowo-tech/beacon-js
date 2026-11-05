import type { BeaconEvent } from './types.js';
import { isPlainObject } from './utils.js';

/** Request headers that carry the client IP; always removed (contract §5). */
export const IP_HEADERS: readonly string[] = [
  'x-forwarded-for',
  'x-real-ip',
  'forwarded',
  'cf-connecting-ip',
  'true-client-ip',
  'x-client-ip',
];

/**
 * Any header that can carry a client address on common hosts and proxies (`X-Original-Forwarded-For`,
 * `X-Cluster-Client-IP`, `Fastly-Client-IP`, `X-Vercel-Forwarded-For`, `CF-Pseudo-IPv4`, `X-Envoy-External-Address`,
 * `X-Appengine-User-Ip`, …). Removed in addition to {@link IP_HEADERS}.
 */
export const IP_HEADER_PATTERN =
  /forwarded|client-?ip|real-?ip|(?:^|-)ip(?:v[46])?$|^cf-|^fastly-|^x-vercel-|external-address|true-client/i;

const ADDRESS_WORDS = new Set([
  'addr',
  'address',
  'ip',
  'ipv4',
  'ipv6',
  'client',
  'forwarded',
  'via',
  'socket',
]);

/**
 * True for a header that can carry a client address (FVD-L1): any name with one of the words `addr`, `address`,
 * `ip`, `client`, `forwarded`, `via` or `socket` (word boundaries are `-`, `_`, `.`, spaces and camelCase, so
 * `X-Azure-SocketIP`, `CloudFront-Viewer-Address`, `X-Remote-Addr`, `Via` and `X-IP-Address` all match), joined
 * forms such as `x-clientip` / `remoteaddr`, and {@link IP_HEADER_PATTERN}.
 */
export function isClientAddressHeader(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[-_.\s]+/);
  return (
    words.some((word) => ADDRESS_WORDS.has(word)) ||
    /client-?ip|real-?ip|remote-?addr|socket-?ip|ip-?addr/i.test(name) ||
    IP_HEADER_PATTERN.test(name)
  );
}

const AUTO = '{{auto}}';

function dropAuto(value: unknown, depth: number): unknown {
  if (depth <= 0) return value;
  if (Array.isArray(value))
    return value.filter((item) => item !== AUTO).map((item) => dropAuto(item, depth - 1));
  if (!isPlainObject(value)) return value;
  for (const key of Object.keys(value)) {
    if (value[key] === AUTO) delete value[key];
    else value[key] = dropAuto(value[key], depth - 1);
  }
  return value;
}

/**
 * The user's IP is never sent. This runs as the last step before encoding, after `beforeSend` and every processor,
 * and it cannot be switched off. It mutates and returns the event.
 */
export function stripIp(event: BeaconEvent): BeaconEvent {
  if (event.user) delete event.user.ip_address;
  const request = event.request;
  if (request) {
    if (request.env) {
      for (const name of Object.keys(request.env))
        if (/^remote_addr$/i.test(name)) delete request.env[name];
    }
    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        if (IP_HEADERS.includes(name.toLowerCase()) || isClientAddressHeader(name))
          delete request.headers[name];
      }
    }
  }
  return dropAuto(event, 20) as BeaconEvent;
}
