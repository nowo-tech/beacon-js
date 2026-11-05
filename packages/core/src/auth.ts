import { BeaconConfigError, publicDsn, type ParsedDsn } from './dsn.js';

/** Turns a parsed DSN into request credentials (contract §6). Never puts credentials in the URL. */
export interface AuthProvider {
  readonly name: string;
  /** Headers added to every request (may be empty). */
  headers(dsn: ParsedDsn): Record<string, string>;
  /** Extra fields for the envelope header line (e.g. `{ dsn }`). */
  envelopeHeader?(dsn: ParsedDsn): Record<string, unknown>;
  /** True when credentials survive without custom headers (enables `sendBeacon`). */
  readonly supportsHeaderless: boolean;
}

function requireSecret(dsn: ParsedDsn): string {
  if (!dsn.secret) throw new BeaconConfigError('Invalid Beacon DSN: a server DSN needs a secret');
  return dsn.secret;
}

/** Default in beacon-node: `X-Beacon-Auth: Beacon beacon_key=<pk>, beacon_secret=<sk>`. */
export function beaconServerAuth(): AuthProvider {
  return {
    name: 'beaconServerAuth',
    supportsHeaderless: false,
    headers: (dsn) => ({
      'X-Beacon-Auth': `Beacon beacon_key=${dsn.publicKey}, beacon_secret=${requireSecret(dsn)}`,
    }),
  };
}

/** Default in beacon-browser: the public `bk_` DSN in the envelope header, and no custom header. */
export function envelopeDsnAuth(): AuthProvider {
  return {
    name: 'envelopeDsnAuth',
    supportsHeaderless: true,
    headers: () => ({}),
    envelopeHeader: (dsn) => ({ dsn: publicDsn(dsn) }),
  };
}

/** Opt-in browser provider: `X-Beacon-Auth: Beacon beacon_key=bk_…`. Every request is preflighted. */
export function headerBrowserKeyAuth(): AuthProvider {
  return {
    name: 'headerBrowserKeyAuth',
    supportsHeaderless: false,
    headers: (dsn) => ({ 'X-Beacon-Auth': `Beacon beacon_key=${dsn.publicKey}` }),
  };
}

/**
 * Opt-in Node provider for proxies that strip custom headers: the full server DSN, secret included, in the envelope
 * header. Not recommended, because the secret travels in the body.
 */
export function serverEnvelopeDsnAuth(): AuthProvider {
  return {
    name: 'serverEnvelopeDsnAuth',
    supportsHeaderless: false,
    headers: (dsn) => {
      requireSecret(dsn);
      return {};
    },
    envelopeHeader: (dsn) => ({ dsn: publicDsn(dsn, true) }),
  };
}
