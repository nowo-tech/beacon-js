import {
  getCurrentScope,
  maskCredentials,
  normalize,
  scrubObject,
  scrubUrl,
  type Client,
  type Integration,
  type Level,
} from '@nowo-tech/beacon-core';

export type ConsoleLevel = 'debug' | 'info' | 'log' | 'warn' | 'error';

export interface BreadcrumbsOptions {
  /** Console levels recorded (default `['warn', 'error']`, `false` disables). */
  console?: ConsoleLevel[] | false;
  /** DOM clicks and key presses (selector only). `text: true` adds the text of non-input elements. */
  dom?: boolean | { text?: boolean };
  /** `history` and `hashchange` navigation. */
  navigation?: boolean;
}

const INPUT_TAGS = ['INPUT', 'TEXTAREA', 'SELECT'];

/** A CSS-like selector of at most 5 levels: `button#save.primary[name="x"]`. Never values or input text. */
export function selectorOf(element: Element | null): string {
  const parts: string[] = [];
  for (
    let node = element;
    node && parts.length < 5 && node.nodeType === 1;
    node = node.parentElement
  ) {
    let part = node.tagName.toLowerCase();
    if (node.id) part += `#${node.id}`;
    for (const name of Array.from(node.classList).slice(0, 2)) part += `.${name}`;
    const attr = node.getAttribute('name');
    if (attr) part += `[name="${attr}"]`;
    parts.unshift(part);
  }
  return parts.join(' > ');
}

/** Object arguments go through the key scrubber before they become text (FV-L6). */
function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return String(value);
  return JSON.stringify(scrubObject(normalize(value, CONSOLE_LIMITS)));
}

const CONSOLE_LIMITS = { depth: 3, maxKeys: 50, maxArray: 50, maxString: 500 };

function relative(url: string): string {
  return scrubUrl(url.replace(location.origin, ''));
}

/** Console, DOM and navigation breadcrumbs (contract §7.2). Every wrapper is restored by `teardown`. */
export function breadcrumbsIntegration(options: BreadcrumbsOptions = {}): Integration {
  const cleanups: Array<() => void> = [];
  return {
    name: 'Breadcrumbs',
    setup(client: Client) {
      const add = (crumb: Parameters<Client['addBreadcrumb']>[0]): void =>
        client.addBreadcrumb(crumb, getCurrentScope());

      for (const level of options.console === false ? [] : (options.console ?? ['warn', 'error'])) {
        const original = console[level];
        const wrapped = function (this: Console, ...args: unknown[]): void {
          try {
            record(args);
          } catch {
            // the app's console call always goes through
          }
          original.apply(this, args);
        };
        const record = (args: unknown[]): void => {
          const message = maskCredentials(args.map(stringify).join(' '));
          if (!message.startsWith('[beacon]')) {
            add({
              category: 'console',
              level: (level === 'warn'
                ? 'warning'
                : level === 'error'
                  ? 'error'
                  : level === 'debug'
                    ? 'debug'
                    : 'info') as Level,
              message,
            });
          }
        };
        console[level] = wrapped;
        cleanups.push(() => {
          if (console[level] === wrapped) console[level] = original;
        });
      }

      if (options.dom !== false) {
        const withText = typeof options.dom === 'object' && options.dom.text === true;
        let lastKeyTarget: EventTarget | null = null;
        const onDom = (event: Event): void => {
          const target = event.target as Element | null;
          if (!target || target.nodeType !== 1) return;
          if (event.type === 'keypress') {
            if (target === lastKeyTarget) return;
            lastKeyTarget = target;
          }
          let message = selectorOf(target);
          if (withText && !INPUT_TAGS.includes(target.tagName)) {
            const text = String(target.textContent).trim().slice(0, 100);
            if (text) message += ` "${text}"`;
          }
          add({ category: event.type === 'click' ? 'ui.click' : 'ui.input', message });
        };
        document.addEventListener('click', onDom, true);
        document.addEventListener('keypress', onDom, true);
        cleanups.push(() => {
          document.removeEventListener('click', onDom, true);
          document.removeEventListener('keypress', onDom, true);
        });
      }

      if (options.navigation !== false) {
        let lastHref = location.href;
        const navigate = (to: string): void => {
          const from = lastHref;
          lastHref = to;
          if (from !== to)
            add({
              category: 'navigation',
              type: 'navigation',
              data: { from: relative(from), to: relative(to) },
            });
        };
        const onChange = (): void => navigate(location.href);
        const originals = { pushState: history.pushState, replaceState: history.replaceState };
        for (const method of ['pushState', 'replaceState'] as const) {
          const original = originals[method];
          history[method] = function (
            this: History,
            data: unknown,
            unused: string,
            url?: string | URL | null,
          ): void {
            original.call(this, data, unused, url);
            if (url !== undefined && url !== null)
              navigate(new URL(String(url), location.href).href);
          };
        }
        addEventListener('popstate', onChange);
        addEventListener('hashchange', onChange);
        cleanups.push(() => {
          history.pushState = originals.pushState;
          history.replaceState = originals.replaceState;
          removeEventListener('popstate', onChange);
          removeEventListener('hashchange', onChange);
        });
      }
    },
    teardown() {
      while (cleanups.length) cleanups.pop()!();
    },
  };
}
