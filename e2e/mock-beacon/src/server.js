// @ts-check
// Mock Beacon: a Node HTTP server that reimplements Beacon's ingest rules from contract §0 and §0.8 (spec 172),
// with a legacy mode matching Beacon at 8f9f27fe. Every rule can be switched off. Test-only; credentials are fakes.
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';

export const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
export const BROWSER_CAP = 200 * 1024;
export const BROWSER_DECOMPRESSED_CAP = 1024 * 1024;
export const SERVER_CAP = 2 * 1024 * 1024;
export const MAX_RATIO = 50;

/**
 * @typedef {{ status: number, headers?: Record<string, string>, body?: string }} ScriptedResponse
 * @typedef {{
 *   mode: 'current' | 'legacy',
 *   projectId: string,
 *   serverKeys: Array<{ public: string, secret: string }>,
 *   browserKeys: string[],
 *   allowedOrigins: string[],
 *   rules: { cors: boolean, gzip: boolean, lengthFraming: boolean, strictLength: boolean, queryAuth: boolean, origin: boolean, caps: boolean, rateLimits: boolean },
 *   limits: { perIp: number, perKeyOrigin: number },
 * }} MockConfig
 */

/** @returns {MockConfig} */
export function defaultConfig() {
  return {
    mode: 'current',
    projectId: PROJECT_ID,
    serverKeys: [{ public: 'test-public', secret: 'test-secret-not-real' }],
    browserKeys: ['bk_test_0000000000000000'],
    allowedOrigins: [],
    rules: {
      cors: true,
      gzip: true,
      lengthFraming: true,
      strictLength: true,
      queryAuth: true,
      origin: true,
      caps: true,
      rateLimits: true,
    },
    limits: { perIp: 60, perKeyOrigin: 600 },
  };
}

/** A port of Beacon's EnvelopeAuthParser: `Beacon k=v, k=v` after the literal prefix. */
export function parseBeaconAuth(header) {
  if (typeof header !== 'string' || !header.startsWith('Beacon ')) return {};
  /** @type {Array<[string, string]>} */
  const entries = [];
  for (const pair of header.slice(7).split(',')) {
    const index = pair.indexOf('=');
    const key = pair.slice(0, index).trim();
    if (index > 0 && key !== '__proto__' && key !== 'constructor' && key !== 'prototype')
      entries.push([key, pair.slice(index + 1).trim()]);
  }
  return Object.fromEntries(entries);
}

class EnvelopeError extends Error {}

/**
 * Parses an envelope body. With `lengthFraming`, an item header `length` is honoured (bytes) and newline framing is
 * the fallback; otherwise (legacy) the payload is always the next line. `strictLength` refuses a `length` that does
 * not end on a newline or the end of the body (an SDK encoder bug).
 * @param {Buffer} body
 * @param {{ lengthFraming: boolean, strictLength: boolean }} rules
 */
export function parseEnvelope(body, rules) {
  const text = Buffer.from(body.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  let pos = 0;
  const readLine = () => {
    const end = text.indexOf(0x0a, pos);
    const line = text.subarray(pos, end === -1 ? text.length : end).toString('utf8');
    pos = end === -1 ? text.length : end + 1;
    return line;
  };
  const object = (line) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new EnvelopeError('invalid envelope');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new EnvelopeError('invalid envelope');
    return value;
  };
  const header = object(readLine());
  const items = [];
  while (pos < text.length) {
    const line = readLine();
    if (line.trim() === '') continue;
    const itemHeader = object(line);
    let payloadText;
    if (rules.lengthFraming && typeof itemHeader.length === 'number') {
      payloadText = text.subarray(pos, pos + itemHeader.length).toString('utf8');
      pos += itemHeader.length;
      if (pos < text.length) {
        if (text[pos] !== 0x0a) {
          if (rules.strictLength) throw new EnvelopeError('item length does not match the payload');
        } else pos++;
      }
    } else {
      payloadText = pos < text.length ? readLine() : '';
    }
    let payload = payloadText;
    try {
      const decoded = JSON.parse(payloadText);
      if (decoded && typeof decoded === 'object') payload = decoded;
    } catch {
      // kept as a raw string, as Beacon does
    }
    items.push({ header: itemHeader, payload, raw: payloadText });
  }
  return { header, items };
}

/** @param {Partial<MockConfig>} [overrides] */
export function createMockBeacon(overrides = {}) {
  /** @type {MockConfig} */
  let config = mergeConfig(defaultConfig(), overrides);
  /** @type {any[]} */
  let requests = [];
  /** @type {ScriptedResponse[]} */
  let script = [];
  const stats = { events: 0, clientReports: 0, dropped: 0, ignored: 0 };
  /** @type {Map<string, number[]>} */
  const windows = new Map();

  const hit = (key, limit) => {
    const now = Date.now();
    const list = (windows.get(key) ?? []).filter((t) => t > now - 60_000);
    list.push(now);
    windows.set(key, list);
    return list.length > limit;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    if (url.pathname.startsWith('/__')) return control(req, res, url);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const wire = Buffer.concat(chunks);
    const record = {
      time: Date.now(),
      method: req.method,
      path: url.pathname,
      query: url.search,
      headers: { ...req.headers },
      wireBytes: wire.length,
      status: 0,
      keyKind: /** @type {string | undefined} */ (undefined),
      envelope: /** @type {any} */ (undefined),
      body: '',
      ip: req.socket.remoteAddress,
    };
    requests.push(record);
    const legacy = config.mode === 'legacy';
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const allowed =
      !legacy &&
      config.rules.cors &&
      origin !== undefined &&
      config.allowedOrigins.includes(origin);
    /** @type {Record<string, string>} */
    const cors = allowed
      ? {
          'Access-Control-Allow-Origin': origin,
          Vary: 'Origin',
          'Access-Control-Expose-Headers': 'Retry-After, X-Beacon-Rate-Limit',
        }
      : {};
    const send = (status, headers = {}, body = '') => {
      record.status = status;
      res.writeHead(status, { ...cors, ...headers });
      res.end(body);
    };

    const match = /^\/api\/([^/]+)\/envelope\/$/.exec(url.pathname);
    if (!match) return send(404);
    if (req.method === 'OPTIONS') {
      if (!allowed) return send(403);
      return send(204, {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Content-Encoding, X-Beacon-Auth',
        'Access-Control-Max-Age': '600',
      });
    }
    if (req.method !== 'POST') return send(405);
    if (
      config.rules.queryAuth &&
      (url.searchParams.has('beacon_key') || url.searchParams.has('beacon_secret'))
    ) {
      return send(401, {}, 'unauthorized');
    }
    const scripted = script.shift();
    if (scripted) {
      // Recorded for assertions (best effort), then answered as scripted.
      try {
        record.body = wire.toString('utf8');
        record.envelope = parseEnvelope(
          req.headers['content-encoding'] === 'gzip' ? gunzipSync(wire) : wire,
          { lengthFraming: true, strictLength: false },
        );
      } catch {
        // not an envelope
      }
      return send(scripted.status, scripted.headers ?? {}, scripted.body ?? '');
    }
    if (config.rules.rateLimits && hit(`ip:${record.ip}`, config.limits.perIp)) {
      return send(
        429,
        { 'Retry-After': '60', 'X-Beacon-Rate-Limit': 'ip', 'Content-Type': 'application/json' },
        '{"message":"rate limit exceeded"}',
      );
    }
    if (!wire.length) return send(400, {}, 'Empty body');
    if (wire.length > SERVER_CAP) return send(413, {}, 'envelope too large');

    let body = wire;
    const encoding = req.headers['content-encoding'];
    if (encoding) {
      if (legacy || !config.rules.gzip || encoding !== 'gzip')
        return send(400, {}, 'invalid envelope');
      try {
        body = gunzipSync(wire, { maxOutputLength: SERVER_CAP + 1 });
      } catch {
        return send(413, {}, 'envelope too large');
      }
      if (body.length / wire.length > MAX_RATIO)
        return send(413, {}, 'decompression ratio too high');
      if (body.length > SERVER_CAP) return send(413, {}, 'envelope too large');
    }
    record.body = body.toString('utf8');

    let envelope;
    try {
      envelope = parseEnvelope(body, {
        lengthFraming: !legacy && config.rules.lengthFraming,
        strictLength: config.rules.strictLength,
      });
    } catch {
      return send(400, {}, 'invalid envelope');
    }
    record.envelope = envelope;

    const auth = parseBeaconAuth(req.headers['x-beacon-auth']);
    let key = auth.beacon_key;
    let secret = auth.beacon_secret;
    if (!key && typeof envelope.header.dsn === 'string') {
      try {
        const dsn = new URL(envelope.header.dsn);
        key = decodeURIComponent(dsn.username) || undefined;
        secret = dsn.password ? decodeURIComponent(dsn.password) : undefined;
      } catch {
        // unparsable dsn: no key
      }
    }
    if (match[1] !== config.projectId) return send(401, {}, 'unauthorized');
    if (key?.startsWith('bk_') && !legacy) {
      record.keyKind = 'browser';
      // `cors` is empty here: an unknown or missing origin gets no CORS headers at all.
      if (config.rules.origin && !allowed) return send(403, {}, 'origin not allowed');
      if (secret !== undefined || !config.browserKeys.includes(key))
        return send(401, {}, 'unauthorized');
      if (config.rules.caps) {
        if (wire.length > BROWSER_CAP) return send(413, {}, 'envelope too large');
        if (body.length > BROWSER_DECOMPRESSED_CAP) return send(413, {}, 'envelope too large');
      }
      if (config.rules.rateLimits && hit(`key:${key}:${origin}`, config.limits.perKeyOrigin)) {
        return send(429, { 'Retry-After': '60', 'X-Beacon-Rate-Limit': 'key' });
      }
      for (const item of envelope.items.slice(0, 50)) {
        const type = item.header.type;
        if (type === 'event' && typeof item.payload === 'object') stats.events++;
        else if (type === 'client_report') stats.clientReports++;
        else stats.dropped++;
      }
      stats.dropped += Math.max(0, envelope.items.length - 50);
      return send(200);
    }
    const serverKey = config.serverKeys.find((candidate) => candidate.public === key);
    if (!serverKey || secret !== serverKey.secret) return send(401, {}, 'unauthorized');
    record.keyKind = 'server';
    for (const item of envelope.items.slice(0, 100)) {
      const type = item.header.type;
      if (type === 'event' && typeof item.payload === 'object') stats.events++;
      else if (type === 'transaction' || type === 'check_in') stats.ignored++;
      else stats.ignored++;
    }
    return send(200);
  });

  /** Control endpoints: GET/DELETE /__requests, POST /__script, POST /__config, GET /__stats. */
  async function control(req, res, url) {
    const json = (status, value) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(value));
    };
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
    if (url.pathname === '/__requests' && req.method === 'GET') return json(200, requests);
    if (url.pathname === '/__requests' && req.method === 'DELETE') {
      reset();
      return json(200, { ok: true });
    }
    if (url.pathname === '/__script' && req.method === 'POST') {
      script.push(...input);
      return json(200, { queued: script.length });
    }
    if (url.pathname === '/__config' && req.method === 'POST') {
      config = mergeConfig(config, input);
      return json(200, config);
    }
    if (url.pathname === '/__stats') return json(200, stats);
    return json(404, { error: 'unknown control endpoint' });
  }

  function reset() {
    requests = [];
    script = [];
    windows.clear();
    Object.assign(stats, { events: 0, clientReports: 0, dropped: 0, ignored: 0 });
  }

  return {
    server,
    get config() {
      return config;
    },
    configure(update) {
      config = mergeConfig(config, update);
    },
    get requests() {
      return requests;
    },
    stats,
    script(...responses) {
      script.push(...responses);
    },
    reset,
    /** @param {number} [port] */
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolve) =>
        server.listen(port, host, () => {
          const address = /** @type {import('node:net').AddressInfo} */ (server.address());
          resolve(`http://${host}:${address.port}`);
        }),
      );
    },
    close() {
      return new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve(undefined));
      });
    },
  };
}

function mergeConfig(base, update = {}) {
  return {
    ...base,
    ...update,
    rules: { ...base.rules, ...(update.rules ?? {}) },
    limits: { ...base.limits, ...(update.limits ?? {}) },
  };
}
