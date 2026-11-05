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
        if (IP_HEADERS.includes(name.toLowerCase()) || IP_HEADER_PATTERN.test(name))
          delete request.headers[name];
      }
    }
  }
  return dropAuto(event, 20) as BeaconEvent;
}
