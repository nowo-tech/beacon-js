/** Configuration error. Its message never contains the DSN or a secret. */
export class BeaconConfigError extends Error {
  override name = 'BeaconConfigError';
}

export type OtlpSignal = 'logs' | 'traces' | 'metrics';

export interface ParsedDsn {
  protocol: 'https' | 'http';
  /** host[:port] */
  host: string;
  /** '' or '/beacon' when Beacon is under a sub-path. */
  pathPrefix: string;
  /** Project UUID (a numeric legacy id is accepted). */
  projectId: string;
  /** Public key, or `bk_…` for a browser key. */
  publicKey: string;
  /** Server secret. Absent for browser keys. */
  secret?: string;
  kind: 'server' | 'browser';
  /** Canonical envelope URL: `{origin}{prefix}/api/ingest/v1/{projectId}/envelope/` (Beacon ≥ 1.147). */
  envelopeUrl(): string;
  /** Canonical OTLP/HTTP URL: `{origin}{prefix}/api/ingest/v1/{projectId}/otlp/v1/{signal}` (Beacon ≥ 1.147). */
  otlpUrl(signal: OtlpSignal): string;
  /**
   * Unversioned envelope URL `{origin}{prefix}/api/{projectId}/envelope/`, a permanent alias that every Beacon serves.
   * Optional for custom parsers: without it the client never falls back (`ingestPaths` is ignored).
   */
  legacyEnvelopeUrl?(): string;
  /** Unversioned OTLP/HTTP URL `{origin}{prefix}/api/{projectId}/otlp/v1/{signal}` (permanent alias). */
  legacyOtlpUrl?(signal: OtlpSignal): string;
}

/**
 * OTLP/HTTP exporter base endpoint (the exporter appends `/v1/{signal}`): `{origin}{prefix}/api/ingest/v1/{projectId}/otlp`,
 * or the unversioned alias with `legacy` (for Beacon < 1.147).
 */
export function otlpEndpoint(dsn: ParsedDsn, legacy = false): string {
  const url = legacy && dsn.legacyOtlpUrl ? dsn.legacyOtlpUrl('traces') : dsn.otlpUrl('traces');
  return url.slice(0, -'/v1/traces'.length);
}

/** Turns user configuration into an ingest target. */
export interface DsnParser {
  /** @throws BeaconConfigError, whose message never contains the secret. */
  parse(dsn: string): ParsedDsn;
}

export const BROWSER_KEY_PREFIX = 'bk_';

const HTTP_HOSTS = new Set(['localhost', '127.0.0.1', 'host.docker.internal']);
const KEY = /^[A-Za-z0-9_-]+$/;
const PROJECT_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i;

function fail(reason: string): never {
  throw new BeaconConfigError(`Invalid Beacon DSN: ${reason}`);
}

/**
 * The default parser: `https://<pk>:<sk>@<host>[:port][/<prefix>]/<projectId>` for server keys and
 * `https://bk_<id>@<host>[:port][/<prefix>]/<projectId>` for browser keys. `http://` is allowed for local hosts only.
 */
export const defaultDsnParser: DsnParser = {
  parse(dsn: string): ParsedDsn {
    // Control characters are exactly what this check is about (CR/LF header injection).
    // eslint-disable-next-line no-control-regex
    if (/[\0-\x1f\x7f]/.test(dsn)) fail('control characters (CR, LF, …) are not allowed');
    let url: URL;
    try {
      url = new URL(dsn);
    } catch {
      fail('not a URL');
    }
    const protocol = url.protocol.slice(0, -1);
    if (protocol !== 'https' && protocol !== 'http') fail('the scheme must be https');
    if (protocol === 'http' && !HTTP_HOSTS.has(url.hostname))
      fail('http is allowed for local hosts only');
    if (url.search || url.hash) fail('query strings and fragments are not allowed');
    const publicKey = url.username;
    if (!publicKey) fail('the public key is missing');
    // Keys and secrets are plain tokens: no percent-escapes, so nothing decodes into a header-breaking character.
    if (!KEY.test(publicKey) || (url.password && !KEY.test(url.password)))
      fail('keys may only contain A-Z, a-z, 0-9, _ and -');
    const secret = url.password || undefined;
    const segments = url.pathname.split('/').filter(Boolean);
    const projectId = segments.pop();
    if (!projectId || !PROJECT_ID.test(projectId)) fail('the project id must be a UUID');
    const kind = publicKey.startsWith(BROWSER_KEY_PREFIX) ? 'browser' : 'server';
    if (kind === 'browser' && secret !== undefined) fail('a browser key never has a secret');
    const base = `${protocol}://${url.host}${segments.length ? `/${segments.join('/')}` : ''}`;
    const at = (version: string, path: string) => `${base}/api/${version}${projectId}/${path}`;
    const parsed: ParsedDsn = {
      protocol,
      host: url.host,
      pathPrefix: segments.length ? `/${segments.join('/')}` : '',
      projectId,
      publicKey,
      kind,
      envelopeUrl: () => at('ingest/v1/', 'envelope/'),
      otlpUrl: (signal) => at('ingest/v1/', `otlp/v1/${signal}`),
      legacyEnvelopeUrl: () => at('', 'envelope/'),
      legacyOtlpUrl: (signal) => at('', `otlp/v1/${signal}`),
    };
    if (secret !== undefined) parsed.secret = secret;
    return parsed;
  },
};

/** The DSN without its secret, for the envelope header (`https://bk_…@host/projectId`). */
export function publicDsn(dsn: ParsedDsn, withSecret = false): string {
  const credentials = withSecret && dsn.secret ? `${dsn.publicKey}:${dsn.secret}` : dsn.publicKey;
  return `${dsn.protocol}://${credentials}@${dsn.host}${dsn.pathPrefix}/${dsn.projectId}`;
}
