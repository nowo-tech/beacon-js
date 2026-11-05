import { fixedError, type GoldenCase } from './shared.ts';

const v8 = (n: number, file = 'https://app.test/assets/app-4c1d2e3f.js') =>
  Array.from({ length: n }, (_, i) => `    at fn${n - i} (${file}:${10 + i}:${5 + i})`);

const grouping = (type: string, value: string, filename: string, fn: string) => ({
  type,
  value_normalised: value,
  filename,
  function: fn,
});
const accepted = { accepted: 1, counted: 0, dropped: 0 };

export const browserCases: GoldenCase[] = [
  {
    name: 'browser-event-exception',
    since: '0.1.0',
    requires: ['spec-172-A', 'spec-172-B'],
    kind: 'browser',
    auth: 'envelope-dsn',
    capture: (sdk) => {
      sdk.setTag('page', 'checkout');
      sdk.addBreadcrumb({
        category: 'navigation',
        type: 'navigation',
        data: { from: '/', to: '/checkout?code=[Filtered]' },
      });
      sdk.captureException(fixedError('TypeError', 'x is undefined', v8(12)), undefined, {
        mechanism: { type: 'onerror', handled: false },
        logger: 'window.onerror',
      });
    },
    expected: {
      status: 200,
      items: accepted,
      event: {
        platform: 'javascript',
        level: 'error',
        grouping: grouping('TypeError', 'x is undefined', 'assets/app.js', 'fn12'),
      },
    },
  },
  {
    name: 'browser-event-message',
    since: '0.1.0',
    requires: ['spec-172-A', 'spec-172-B'],
    kind: 'browser',
    auth: 'envelope-dsn',
    capture: (sdk) => void sdk.captureMessage('Payment provider slow: 4200 ms', 'warning'),
    expected: {
      status: 200,
      items: accepted,
      event: {
        platform: 'javascript',
        level: 'warning',
        grouping: grouping('', 'Payment provider slow: <n> ms', '', ''),
      },
    },
  },
  {
    name: 'browser-event-cause-chain',
    since: '0.1.0',
    requires: ['spec-172-A', 'spec-172-B'],
    kind: 'browser',
    auth: 'envelope-dsn',
    capture: (sdk) => {
      const root = fixedError('NetworkError', 'connection reset', [
        '    at socket (https://app.test/assets/net-0a1b2c3d.js:1:1)',
      ]);
      const middle = fixedError(
        'RepositoryError',
        'cannot load cart 42',
        ['    at load (https://app.test/assets/repo.js:2:2)'],
        root,
      );
      const top = fixedError(
        'CheckoutError',
        'checkout failed',
        ['    at submit (https://app.test/assets/checkout.js:3:3)'],
        middle,
      );
      sdk.captureException(top);
    },
    expected: {
      status: 200,
      items: accepted,
      event: {
        platform: 'javascript',
        level: 'error',
        grouping: grouping('CheckoutError', 'checkout failed', 'assets/checkout.js', 'submit'),
      },
    },
  },
  {
    name: 'browser-event-spidermonkey',
    since: '0.1.0',
    requires: ['spec-172-A', 'spec-172-B'],
    kind: 'browser',
    auth: 'envelope-dsn',
    capture: (sdk) => {
      const error = new TypeError('can\'t access property "id", user is undefined');
      error.stack = [
        'render@https://app.test/assets/view.js:12:7',
        'update/<@https://app.test/assets/view.js:40:3',
        'evalFn@https://app.test/vendor.js line 3 > eval:1:1',
        '@https://app.test/main.js:1:1',
        '',
      ].join('\n');
      sdk.captureException(error);
    },
    expected: {
      status: 200,
      items: accepted,
      event: {
        platform: 'javascript',
        level: 'error',
        grouping: grouping(
          'TypeError',
          'can\'t access property "id", user is undefined',
          'assets/view.js',
          'render',
        ),
      },
    },
  },
  {
    name: 'browser-event-jsc',
    since: '0.1.0',
    requires: ['spec-172-A', 'spec-172-B'],
    kind: 'browser',
    auth: 'envelope-dsn',
    capture: (sdk) => {
      const error = new TypeError("undefined is not an object (evaluating 'user.id')");
      error.stack = [
        'render@https://app.test/assets/view.js:12:7',
        'forEach@[native code]',
        'global code@https://app.test/main.js:1:1',
      ].join('\n');
      sdk.captureException(error);
    },
    expected: {
      status: 200,
      items: accepted,
      event: {
        platform: 'javascript',
        level: 'error',
        grouping: grouping(
          'TypeError',
          "undefined is not an object (evaluating 'user.id')",
          'assets/view.js',
          'render',
        ),
      },
    },
  },
  {
    name: 'browser-event-hashed-filename',
    since: '0.1.0',
    requires: ['spec-172-A', 'spec-172-B'],
    kind: 'browser',
    auth: 'envelope-dsn',
    capture: (sdk) =>
      void sdk.captureException(
        fixedError('Error', 'boom', [
          '    at handler (https://app.test/assets/index-3f9a1c2b.js?v=1:1:100)',
        ]),
      ),
    expected: {
      status: 200,
      items: accepted,
      event: {
        platform: 'javascript',
        level: 'error',
        grouping: grouping('Error', 'boom', 'assets/index.js', 'handler'),
      },
    },
  },
  {
    name: 'browser-event-unicode',
    since: '0.1.0',
    requires: ['spec-172-A', 'spec-172-B'],
    kind: 'browser',
    auth: 'envelope-dsn',
    capture: (sdk) => {
      sdk.setTag('locale', 'es-ES');
      sdk.captureException(
        fixedError('Error', 'Pago rechazado: «tarjeta» ñandú 😀 日本語 \uD800 end', [
          '    at pay (https://app.test/assets/pay.js:1:1)',
        ]),
      );
    },
    expected: {
      status: 200,
      items: accepted,
      event: {
        platform: 'javascript',
        level: 'error',
        grouping: grouping(
          'Error',
          'Pago rechazado: «tarjeta» ñandú 😀 日本語 � end',
          'assets/pay.js',
          'pay',
        ),
      },
    },
  },
  {
    name: 'browser-event-max-caps',
    since: '0.1.0',
    requires: ['spec-172-A', 'spec-172-B'],
    kind: 'browser',
    auth: 'envelope-dsn',
    options: { maxBreadcrumbs: 100 },
    capture: (sdk) => {
      for (let i = 0; i < 120; i++)
        sdk.addBreadcrumb({
          category: 'app',
          message: `step ${i}`,
          data: { detail: `${i}:`.padEnd(1700, 'x') },
        });
      const error = fixedError('Error', 'm'.repeat(20_000), v8(80));
      sdk.captureException(error, {
        extra: {
          blob: 'y'.repeat(1900),
          list: Array.from({ length: 100 }, (_, i) => `${i}`.padEnd(1900, 'z')),
        },
      });
    },
    expected: {
      status: 200,
      items: accepted,
      event: {
        platform: 'javascript',
        level: 'error',
        grouping: grouping('Error', `${'m'.repeat(8191)}…`, 'assets/app.js', 'fn80'),
      },
    },
  },
  {
    name: 'browser-event-header-auth',
    since: '0.1.0',
    requires: ['spec-172-A', 'spec-172-B'],
    kind: 'browser',
    auth: 'header',
    capture: (sdk) =>
      void sdk.captureException(
        fixedError('Error', 'preflighted', ['    at f (https://app.test/assets/a.js:1:1)']),
      ),
    expected: {
      status: 200,
      items: accepted,
      event: {
        platform: 'javascript',
        level: 'error',
        grouping: grouping('Error', 'preflighted', 'assets/a.js', 'f'),
      },
    },
  },
  {
    name: 'browser-event-gzip',
    since: '0.1.0',
    requires: ['spec-172-A', 'spec-172-B'],
    kind: 'browser',
    auth: 'envelope-dsn',
    gzip: true,
    options: { maxBreadcrumbs: 100 },
    capture: (sdk) => {
      let seed = 12345;
      const noise = () =>
        Array.from(
          { length: 120 },
          () =>
            ((seed = (seed * 1103515245 + 12345) % 2147483648) % 36).toString(36) +
            (seed % 5 ? '' : ' '),
        ).join('');
      for (let i = 0; i < 100; i++)
        sdk.addBreadcrumb({
          category: 'fetch',
          type: 'http',
          data: {
            method: 'GET',
            url: `/api/items/${i * 7919}`,
            status_code: 200,
            trace: `${noise()}-${noise()}-${noise()}`,
          },
        });
      sdk.captureException(fixedError('Error', 'large event', v8(30)));
    },
    expected: {
      status: 200,
      items: accepted,
      event: {
        platform: 'javascript',
        level: 'error',
        grouping: grouping('Error', 'large event', 'assets/app.js', 'fn30'),
      },
    },
  },
  {
    name: 'browser-client-report',
    since: '0.1.0',
    requires: ['spec-172-A', 'spec-172-B'],
    kind: 'browser',
    auth: 'envelope-dsn',
    capture: (sdk) => {
      sdk.discard('self_throttle', 3);
      sdk.discard('sample_rate', 1);
    },
    expected: { status: 200, items: { accepted: 0, counted: 1, dropped: 0 } },
  },
  {
    name: 'negative-browser-no-origin',
    since: '0.1.0',
    requires: ['spec-172-A', 'spec-172-B'],
    kind: 'browser',
    auth: 'envelope-dsn',
    origin: null,
    capture: (sdk) => void sdk.captureMessage('no origin'),
    expected: { status: 403 },
  },
];
