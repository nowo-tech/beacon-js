// Imports the package's own entry (not ./init.js), so that `./element` shares the SDK code with the main entry
// instead of bundling a second copy of it.
import {
  close,
  flush,
  getClient,
  init,
  setUser,
  type BrowserOptions,
  type ClientOutcome,
} from '@nowo-tech/beacon-browser';

let owner: BeaconReporter | undefined;
const SHEET_CSS = ':host{display:none}';

/**
 * `<beacon-reporter dsn="https://bk_…@host/<project>">`: initialises the SDK from attributes (contract §7.3). The
 * first connected element owns the global client; later ones warn and stay inert. It renders nothing.
 */
export class BeaconReporter extends HTMLElement {
  static readonly observedAttributes = [
    'dsn',
    'release',
    'dist',
    'environment',
    'sample-rate',
    'debug',
    'disabled',
    'user-id',
    'ignore-errors',
  ];

  private options: BrowserOptions | undefined;

  connectedCallback(): void {
    if (owner && owner !== this) {
      console.warn('[beacon] a <beacon-reporter> already owns the client; this one stays inert');
      return;
    }
    // The module-level owner is the element itself, by design (one global client per page).
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    owner = this;
    if (!this.shadowRoot) this.renderShadow();
    if (!this.hasAttribute('disabled')) this.start();
    this.emit('ready', {});
  }

  disconnectedCallback(): void {
    if (owner === this) void flush(2000);
  }

  attributeChangedCallback(name: string, previous: string | null, value: string | null): void {
    if (owner !== this || previous === value || !this.isConnected) return;
    const options = this.options;
    if (name === 'disabled') {
      if (value === null) this.start();
      else this.stop();
    } else if (name === 'user-id') {
      setUser(value ? { id: value } : null);
    } else if (options && (name === 'release' || name === 'environment')) {
      if (value === null) delete options[name];
      else options[name] = value;
    } else if (name === 'dsn' && !this.hasAttribute('disabled')) {
      this.start();
    }
  }

  private renderShadow(): void {
    const root = this.attachShadow({ mode: 'open' });
    if ('adoptedStyleSheets' in root && typeof CSSStyleSheet.prototype.replaceSync === 'function') {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(SHEET_CSS);
      root.adoptedStyleSheets = [sheet];
    } else {
      const style = document.createElement('style');
      const nonce = this.getAttribute('nonce');
      if (nonce) style.nonce = nonce;
      style.textContent = SHEET_CSS;
      root.append(style);
    }
  }

  private start(): void {
    const dsn = this.getAttribute('dsn');
    if (!dsn) {
      console.warn('[beacon] <beacon-reporter> needs a dsn attribute');
      return;
    }
    const options: BrowserOptions = {
      dsn,
      debug: this.hasAttribute('debug'),
      onOutcome: (outcome: ClientOutcome) => {
        if (outcome.type === 'captured') this.emit('captured', { eventId: outcome.eventId });
        else if (outcome.type === 'dropped') this.emit('dropped', { reason: outcome.reason });
        else this.emit('error', { status: outcome.status });
      },
    };
    for (const name of ['release', 'dist', 'environment'] as const) {
      const value = this.getAttribute(name);
      if (value !== null) options[name] = value;
    }
    const paths = this.getAttribute('ingest-paths');
    if (paths === 'auto' || paths === 'versioned' || paths === 'legacy')
      options.ingestPaths = paths;
    const rate = this.getAttribute('sample-rate');
    if (rate !== null && rate !== '' && !Number.isNaN(Number(rate)))
      options.sampleRate = Math.min(1, Math.max(0, Number(rate)));
    const ignore = this.getAttribute('ignore-errors');
    if (ignore)
      options.ignoreErrors = ignore
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean);
    this.options = options;
    init(options);
    const userId = this.getAttribute('user-id');
    if (userId) setUser({ id: userId });
  }

  private stop(): void {
    if (getClient()) void close(2000);
  }

  private emit(name: string, detail: Record<string, unknown>): void {
    this.dispatchEvent(
      new CustomEvent(`beacon:${name}`, { bubbles: true, composed: true, detail }),
    );
  }
}

/** Registers `<beacon-reporter>` once (guarded against double definition). */
export function defineBeaconReporter(registry: CustomElementRegistry = customElements): void {
  if (!registry.get('beacon-reporter')) registry.define('beacon-reporter', BeaconReporter);
}

/** Test helper: forgets the owning element. */
export function resetBeaconReporterOwner(): void {
  owner = undefined;
}
