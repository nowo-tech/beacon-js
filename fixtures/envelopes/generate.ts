// Generates the golden envelope set (contract §11.5) with the real SDK client and encoder from fixed inputs.
// Run: node fixtures/envelopes/generate.ts  (Node >= 22.18, after `pnpm build`). CI fails if the output changes.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  browserPlatform,
  Client,
  envelopeDsnAuth,
  groupingInputs,
  headerBrowserKeyAuth,
  Scope,
  type BrowserOptions,
  type Transport,
  type TransportRequest,
} from '@nowo-tech/beacon-browser';
import {
  beaconServerAuth,
  nodePlatform,
  serverEnvelopeDsnAuth,
  type NodeOptions,
} from '@nowo-tech/beacon-node';
import { browserCases } from './inputs/browser.ts';
import { nodeCases } from './inputs/node.ts';
import {
  BROWSER_DSN,
  CLOCK_MS,
  ORIGIN,
  PROJECT,
  SERVER_DSN,
  type GoldenCase,
  type Sdk,
} from './inputs/shared.ts';

const out = new URL('./golden/', import.meta.url);
const version = (
  JSON.parse(
    readFileSync(new URL('../../packages/browser/package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;

async function run(goldenCase: GoldenCase): Promise<TransportRequest> {
  const requests: TransportRequest[] = [];
  const transport: Transport = {
    send: (request) => {
      requests.push(request);
      return Promise.resolve({ kind: 'ok' });
    },
    flush: () => Promise.resolve(true),
  };
  let seq = 0;
  const base = {
    transport,
    integrations: [],
    release: 'golden@1.0.0',
    environment: 'production',
    clock: () => CLOCK_MS,
    generateEventId: () => `00000000000040008000${String(++seq).padStart(12, '0')}`,
    random: () => 0.5,
    ...goldenCase.options,
  };
  let client: Client;
  if (goldenCase.kind === 'browser') {
    const options: BrowserOptions = {
      ...base,
      dsn: BROWSER_DSN,
      authProvider: goldenCase.auth === 'header' ? headerBrowserKeyAuth() : envelopeDsnAuth(),
    };
    client = new Client(options, browserPlatform(options));
  } else {
    const options: NodeOptions = {
      ...base,
      dsn: SERVER_DSN,
      appRoot: '/srv/app',
      authProvider:
        goldenCase.auth === 'server-envelope-dsn' ? serverEnvelopeDsnAuth() : beaconServerAuth(),
    };
    client = new Client(options as never, nodePlatform(options));
  }
  const scope = new Scope();
  const sdk: Sdk = {
    captureException: (error, context, hint) =>
      client.captureException(error, scope, context as never, hint as never),
    captureMessage: (message, level) =>
      client.captureMessage(message, scope, (level ?? 'info') as never),
    addBreadcrumb: (crumb) => client.addBreadcrumb(crumb, scope),
    setTag: (key, value) => void scope.setTag(key, value),
    setUser: (user) => void scope.setUser(user),
    setRequest: (request) => void (scope.request = request),
    discard: (reason, quantity) => client.discard(reason as never, 'error', quantity),
  };
  goldenCase.capture!(sdk);
  await client.flush(5000);
  if (goldenCase.name === 'browser-client-report') await client.sendClientReport(false);
  const request = requests.at(-1);
  if (!request) throw new Error(`${goldenCase.name}: the SDK sent nothing`);
  return request;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const index = [];
for (const goldenCase of [...browserCases, ...nodeCases]) {
  let body: string;
  let headers: Record<string, string> = {};
  if (goldenCase.rawBody) {
    body = goldenCase.rawBody();
    headers['X-Beacon-Auth'] =
      'Beacon beacon_key=golden-public, beacon_secret=golden-secret-not-real';
  } else {
    const request = await run(goldenCase);
    body = request.body;
    headers = { ...request.headers };
  }
  headers['Content-Type'] =
    goldenCase.kind === 'browser' ? 'text/plain;charset=UTF-8' : 'application/x-beacon-envelope';
  const origin =
    goldenCase.origin === undefined
      ? goldenCase.kind === 'browser'
        ? ORIGIN
        : null
      : goldenCase.origin;
  if (origin) headers['Origin'] = origin;
  if (goldenCase.gzip) headers['Content-Encoding'] = 'gzip';

  const lines = body.split('\n');
  const payload =
    lines[2] === undefined ? undefined : (JSON.parse(lines[2]) as Record<string, unknown>);
  if (goldenCase.expected.event) {
    const actual = groupingInputs(payload as never);
    const grouping = { ...actual, filename: actual.filename.replace(/^\//, '') };
    const event = { platform: payload!['platform'], level: payload!['level'], grouping };
    if (JSON.stringify(event) !== JSON.stringify(goldenCase.expected.event)) {
      throw new Error(
        `${goldenCase.name}: expected ${JSON.stringify(goldenCase.expected.event).slice(-200)}, got ${JSON.stringify(event).slice(-200)}`,
      );
    }
  }

  const file = `${goldenCase.name}.envelope${goldenCase.gzip ? '.gz' : ''}`;
  const gz = gzipSync(body, { level: 6 });
  const ratio = Buffer.byteLength(body) / gz.length;
  if (
    goldenCase.gzip &&
    !goldenCase.rawBody &&
    (Buffer.byteLength(body) <= (goldenCase.kind === 'browser' ? 32_768 : 1024) || ratio > 50)
  ) {
    throw new Error(
      `${goldenCase.name}: the SDK would not gzip this body (${Buffer.byteLength(body)} bytes, ratio ${ratio.toFixed(1)})`,
    );
  }
  if (goldenCase.rawBody && ratio <= 50)
    throw new Error(`${goldenCase.name}: the ratio must exceed 50:1`);
  writeFileSync(new URL(file, out), goldenCase.gzip ? gz : body);
  const request = {
    method: 'POST',
    path: `/api/{projectId}/envelope/${goldenCase.query ?? ''}`,
    project_id: PROJECT,
    headers,
  };
  writeFileSync(
    new URL(`${goldenCase.name}.request.json`, out),
    `${JSON.stringify(request, null, 2)}\n`,
  );
  writeFileSync(
    new URL(`${goldenCase.name}.expected.json`, out),
    `${JSON.stringify(goldenCase.expected, null, 2)}\n`,
  );
  index.push({
    name: goldenCase.name,
    since: goldenCase.since,
    min_beacon: null,
    requires: goldenCase.requires,
    key_kind: goldenCase.kind,
    envelope: file,
    request: `${goldenCase.name}.request.json`,
    expected: `${goldenCase.name}.expected.json`,
  });
}
const manifest = {
  schema: 'nowo.beacon-js.golden/v1',
  sdk_version: version,
  git_sha: null,
  placeholders: {
    project: PROJECT,
    host: 'beacon.test',
    browser_key: 'bk_golden_0000000000000000',
    server_key: 'golden-public',
    server_secret: 'golden-secret-not-real',
    origin: ORIGIN,
  },
  cases: index,
};
writeFileSync(new URL('index.json', out), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`golden: ${index.length} cases written to fixtures/envelopes/golden/`);
