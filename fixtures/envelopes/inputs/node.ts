import { encodeEnvelopeForGolden } from './raw.ts';
import { fixedError, type GoldenCase } from './shared.ts';

const accepted = { accepted: 1, counted: 0, dropped: 0 };

export const nodeCases: GoldenCase[] = [
  {
    name: 'node-event-express',
    since: '0.1.0',
    requires: [],
    kind: 'server',
    auth: 'server-header',
    capture: (sdk) => {
      sdk.setRequest({
        method: 'POST',
        url: 'https://shop.test/users/42?token=abc&page=2',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer secret-value',
          'x-forwarded-for': '203.0.113.9',
          cookie: 'sid=1',
        },
      });
      sdk.setTag('route', 'POST /users/:id');
      sdk.captureException(
        fixedError('Error', 'User 42 not found', [
          '    at findUser (/srv/app/src/routes/users.js:10:11)',
          '    at Layer.handle (/srv/app/node_modules/express/lib/router/layer.js:95:5)',
        ]),
        undefined,
        { mechanism: { type: 'express', handled: false } },
      );
    },
    expected: {
      status: 200,
      items: accepted,
      event: {
        platform: 'node',
        level: 'error',
        grouping: grouping('Error', 'User <n> not found', 'src/routes/users.js', 'findUser'),
      },
    },
  },
  {
    name: 'node-event-uncaught',
    since: '0.1.0',
    requires: [],
    kind: 'server',
    auth: 'server-header',
    capture: (sdk) =>
      void sdk.captureException(
        fixedError('RangeError', 'Invalid array length', [
          '    at boot (/srv/app/src/index.js:3:9)',
          '    at node:internal/main/run_main_module:28:49',
        ]),
        { level: 'fatal' },
        { mechanism: { type: 'onuncaughtexception', handled: false } },
      ),
    expected: {
      status: 200,
      items: accepted,
      event: {
        platform: 'node',
        level: 'fatal',
        grouping: grouping('RangeError', 'Invalid array length', 'src/index.js', 'boot'),
      },
    },
  },
  {
    name: 'node-event-gzip',
    since: '0.1.0',
    requires: ['spec-172-gzip'],
    kind: 'server',
    auth: 'server-header',
    gzip: true,
    options: { maxBreadcrumbs: 100 },
    capture: (sdk) => {
      let seed = 777;
      const noise = () =>
        Array.from(
          { length: 40 },
          () =>
            ((seed = (seed * 1103515245 + 12345) % 2147483648) % 36).toString(36) +
            (seed % 5 ? '' : ' '),
        ).join('');
      for (let i = 0; i < 100; i++)
        sdk.addBreadcrumb({
          category: 'http',
          data: {
            url: `https://api.test/v1/items/${i * 104729}`,
            status_code: 200 + (i % 3),
            trace: `${noise()}${noise()}${noise()}${noise()}`,
          },
        });
      sdk.captureException(
        fixedError('Error', 'gzip body', ['    at job (/srv/app/src/jobs/sync.js:1:1)']),
      );
    },
    expected: {
      status: 200,
      items: accepted,
      event: {
        platform: 'node',
        level: 'error',
        grouping: grouping('Error', 'gzip body', 'src/jobs/sync.js', 'job'),
      },
    },
  },
  {
    name: 'node-envelope-dsn-auth',
    since: '0.1.0',
    requires: [],
    kind: 'server',
    auth: 'server-envelope-dsn',
    capture: (sdk) =>
      void sdk.captureException(
        fixedError('Error', 'behind a proxy', ['    at handler (/srv/app/src/proxy.js:1:1)']),
      ),
    expected: {
      status: 200,
      items: accepted,
      event: {
        platform: 'node',
        level: 'error',
        grouping: grouping('Error', 'behind a proxy', 'src/proxy.js', 'handler'),
      },
    },
  },
  {
    name: 'negative-query-credentials',
    since: '0.1.0',
    requires: [],
    kind: 'server',
    auth: 'server-header',
    query: '?beacon_key=golden-public',
    capture: (sdk) => void sdk.captureMessage('query credentials'),
    expected: { status: 401 },
  },
  {
    name: 'negative-ratio-over-50',
    since: '0.1.0',
    requires: ['spec-172-gzip'],
    kind: 'server',
    auth: 'server-header',
    gzip: true,
    rawBody: () => encodeEnvelopeForGolden({ message: 'a'.repeat(200_000), platform: 'node' }),
    expected: { status: 413 },
  },
];

function grouping(type: string, value: string, filename: string, fn: string) {
  return { type, value_normalised: value, filename, function: fn };
}
