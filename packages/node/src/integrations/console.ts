import { addBreadcrumb, type Integration } from '@nowo-tech/beacon-core';

type Method = 'warn' | 'error';

function format(args: unknown[]): string {
  return args
    .map((arg) => {
      try {
        return typeof arg === 'string' ? arg : String(arg);
      } catch {
        return '[unserializable]';
      }
    })
    .join(' ');
}

/** Breadcrumbs for `console.warn` and `console.error`. The originals are called unchanged and restored on teardown. */
export function consoleIntegration(methods: Method[] = ['warn', 'error']): Integration {
  const originals = new Map<Method, (...args: unknown[]) => void>();
  return {
    name: 'Console',
    setup() {
      for (const method of methods) {
        const original = console[method];
        originals.set(method, original);
        console[method] = function (this: unknown, ...args: unknown[]): void {
          const message = format(args);
          if (!message.startsWith('[beacon]')) {
            addBreadcrumb({
              category: 'console',
              level: method === 'warn' ? 'warning' : 'error',
              message,
            });
          }
          return original.apply(this, args);
        };
      }
    },
    teardown() {
      for (const [method, original] of originals) console[method] = original;
      originals.clear();
    },
  };
}
