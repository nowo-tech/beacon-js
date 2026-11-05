import type { AuthProvider } from './auth.js';
import { dedupeKey } from './dedupe.js';
import { BeaconConfigError, defaultDsnParser, type DsnParser, type ParsedDsn } from './dsn.js';
import { encodeEnvelope, serializeLine } from './envelope.js';
import { exceptionsFromError } from './exception.js';
import { expandFingerprint } from './fingerprint.js';
import { stripIp } from './privacy.js';
import type { EnvelopeQueue, QueuedEnvelope } from './queue.js';
import { backoffDelay, MAX_RETRY_AFTER_MS } from './ratelimit.js';
import type { Scope } from './scope.js';
import { defaultScrubber, type Scrubber } from './scrub.js';
import type { FrameOptions } from './stack.js';
import { resolveThrottle, Throttle, type ThrottleOptions } from './throttle.js';
import { applyCaps, fitEvent, MAX_BREADCRUMBS } from './truncate.js';
import type { Transport, TransportResult } from './transport.js';
import type {
  BeaconEvent,
  Breadcrumb,
  CaptureContext,
  Category,
  DiscardReason,
  EventHint,
  Level,
  StackFrame,
} from './types.js';
import { byteLength, EVENT_ID, matchesAny, schedule, uuid4 } from './utils.js';

export interface Integration {
  name: string;
  /** Installs handlers. Called once, when the client is initialised. */
  setup?(client: Client): void;
  /** Can modify the event, or drop it by returning `null`. */
  processEvent?(event: BeaconEvent, hint: EventHint, client: Client): BeaconEvent | null;
  /** Removes handlers and restores every wrapped function (called by `close()`). */
  teardown?(): void;
}

/** What happened to an event or request; the `<beacon-reporter>` element turns these into DOM events. */
export type ClientOutcome =
  | { type: 'captured'; eventId: string }
  | { type: 'dropped'; reason: DiscardReason }
  | { type: 'error'; status: number };

export type BeforeSend = (
  event: BeaconEvent,
  hint: EventHint,
) => BeaconEvent | null | PromiseLike<BeaconEvent | null>;

export interface ClientOptions {
  dsn: string;
  dsnParser?: DsnParser;
  authProvider?: AuthProvider;
  transport?: Transport;
  release?: string;
  dist?: string;
  /** Default `production`. */
  environment?: string;
  /** Node only; sent only when set explicitly or with `sendDefaultPii`. */
  serverName?: string;
  /** 0–1, default 1. Applied before `beforeSend`. */
  sampleRate?: number;
  /** Default 50, clamped to 100. */
  maxBreadcrumbs?: number;
  sendDefaultPii?: boolean;
  integrations?: Integration[] | ((defaults: Integration[]) => Integration[]);
  beforeSend?: BeforeSend;
  beforeBreadcrumb?: (crumb: Breadcrumb, hint?: Record<string, unknown>) => Breadcrumb | null;
  ignoreErrors?: Array<string | RegExp>;
  denyUrls?: Array<string | RegExp>;
  allowUrls?: Array<string | RegExp>;
  inAppInclude?: Array<string | RegExp>;
  inAppExclude?: Array<string | RegExp>;
  /** Replaces the default filename normalisation of a frame. */
  normalizeFilename?: (frame: StackFrame) => string;
  debug?: boolean;
  enabled?: boolean;
  initialScope?: CaptureContext;
  /** Default true. */
  sendClientReports?: boolean;
  /** Uncompressed envelope cap. The browser can only lower it below 200 kB. */
  maxEnvelopeBytes?: number;
  throttle?: Partial<ThrottleOptions>;
  maxEventsPerSession?: number;
  /** `'auto'` (default) or `false`. */
  compression?: 'auto' | false;
  scrubber?: false | Scrubber;
  /** Envelope queue for retries and offline use; `false` disables it. */
  queue?: EnvelopeQueue | false;
  /** Milliseconds since the epoch (tests, golden envelopes). */
  clock?: () => number;
  generateEventId?: () => string;
  random?: () => number;
  /** Called when an event is accepted by Beacon, dropped, or refused with an HTTP error. */
  onOutcome?: (outcome: ClientOutcome) => void;
}

/** What a runtime package (browser, node) plugs into the client. */
export interface PlatformConfig {
  platform: 'javascript' | 'node';
  sdkName: string;
  sdkVersion: string;
  defaultIntegrations: Integration[];
  defaultAuth: () => AuthProvider;
  makeTransport: (options: ClientOptions) => Transport;
  /** Returns a reason when the DSN must be refused on this platform. */
  validateDsn: (dsn: ParsedDsn) => string | undefined;
  /** `warn`: log and stay disabled (browser); `throw` (Node). */
  onConfigError: 'warn' | 'throw';
  maxEnvelopeBytes: number;
  /** User values may only lower the caps and the throttle (browser). */
  lowerOnly: boolean;
  throttle: ThrottleOptions;
  identicalWindowMs: number;
  maxEventsPerSession?: number;
  inFlightCap: number;
  defaultQueue?: () => EnvelopeQueue | undefined;
  isOnline?: () => boolean;
  normalizeFilename: (absPath: string) => string;
  defaultIgnoreErrors?: Array<string | RegExp>;
}

const DISABLE_MS = 60 * 60 * 1000;
const REPORT_INTERVAL_MS = 60 * 1000;
const ENVELOPE_OVERHEAD = 512;

type SendOutcome = 'sent' | 'queued' | 'dropped';

export class Client {
  readonly options: ClientOptions;
  readonly platform: PlatformConfig;
  readonly dsn: ParsedDsn | undefined;
  readonly integrations: Integration[];
  /** The last `X-Beacon-Rate-Limit` value Beacon sent. */
  lastRateLimit: string | undefined;

  private readonly transport: Transport | undefined;
  private readonly authProvider: AuthProvider;
  private readonly headers: Record<string, string> = {};
  private readonly queue: EnvelopeQueue | undefined;
  private readonly throttle: Throttle;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly tasks = new Set<Promise<void>>();
  private readonly identical = new Map<string, number>();
  private readonly discards = new Map<string, number>();
  private readonly frameOptions: FrameOptions;
  private capBytes: number;
  private closed = false;
  private disabledUntil = 0;
  private blockedUntil = 0;
  private failures = 0;
  private opaqueFailures = 0;
  private inFlight = 0;
  private sessionEvents = 0;
  private lastReportAt: number;
  private reportTimer: ReturnType<typeof setTimeout> | undefined;
  private drainTimer: ReturnType<typeof setTimeout> | undefined;
  private draining = false;
  private networkBlocked = false;
  private warned = new Set<string>();

  constructor(options: ClientOptions, platform: PlatformConfig) {
    this.options = options;
    this.platform = platform;
    this.now = options.clock ?? Date.now;
    this.random = options.random ?? Math.random;
    this.lastReportAt = this.now();
    this.authProvider = options.authProvider ?? platform.defaultAuth();
    let dsn: ParsedDsn | undefined;
    try {
      dsn = (options.dsnParser ?? defaultDsnParser).parse(options.dsn);
      const refusal = platform.validateDsn(dsn);
      if (refusal) throw new BeaconConfigError(`Invalid Beacon DSN: ${refusal}`);
      Object.assign(this.headers, this.authProvider.headers(dsn));
    } catch (error) {
      if (platform.onConfigError === 'throw') throw error;
      this.warn('config', `${(error as Error).message}. Beacon is disabled.`, true);
      dsn = undefined;
    }
    this.dsn = dsn;
    const userCap = options.maxEnvelopeBytes;
    this.capBytes =
      userCap && userCap > 0
        ? platform.lowerOnly
          ? Math.min(userCap, platform.maxEnvelopeBytes)
          : userCap
        : platform.maxEnvelopeBytes;
    this.throttle = new Throttle(
      resolveThrottle(platform.throttle, options.throttle, platform.lowerOnly),
      this.now,
    );
    this.frameOptions = { normalizeFilename: platform.normalizeFilename };
    if (options.inAppInclude) this.frameOptions.inAppInclude = options.inAppInclude;
    if (options.inAppExclude) this.frameOptions.inAppExclude = options.inAppExclude;
    this.transport = dsn ? (options.transport ?? platform.makeTransport(options)) : undefined;
    this.queue = options.queue === false ? undefined : (options.queue ?? platform.defaultQueue?.());
    const configured = options.integrations;
    this.integrations =
      typeof configured === 'function'
        ? configured(platform.defaultIntegrations)
        : (configured ?? platform.defaultIntegrations);
    if (options.scrubber === false) this.log('the default scrubber is disabled');
  }

  /** Installs the integrations and starts flushing a persisted queue. */
  setup(): this {
    if (!this.isActive()) return this;
    for (const integration of this.integrations) integration.setup?.(this);
    if (this.queue) this.scheduleDrain(0);
    return this;
  }

  isActive(): boolean {
    return this.options.enabled !== false && !this.closed && this.dsn !== undefined;
  }

  /** Debug log (only with `debug: true`). Never receives the DSN or a secret. */
  log(message: string): void {
    if (this.options.debug) console.warn(`[beacon] ${message}`);
  }

  private warn(key: string, message: string, always = false): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    if (always) console.warn(`[beacon] ${message}`);
    else this.log(message);
  }

  get maxBreadcrumbs(): number {
    return Math.min(Math.max(0, this.options.maxBreadcrumbs ?? 50), MAX_BREADCRUMBS);
  }

  /** The current uncompressed envelope cap (halved after a `413`). */
  get maxEnvelopeBytes(): number {
    return this.capBytes;
  }

  addBreadcrumb(crumb: Breadcrumb, scope: Scope, hint?: Record<string, unknown>): void {
    const max = this.maxBreadcrumbs;
    if (!max || !this.isActive()) return;
    let result: Breadcrumb | null = { timestamp: this.now() / 1000, ...crumb };
    if (this.options.beforeBreadcrumb) result = this.options.beforeBreadcrumb(result, hint);
    if (result) scope.addBreadcrumb(result, max);
  }

  captureException(
    error: unknown,
    scope: Scope,
    context?: CaptureContext,
    hint: EventHint = {},
  ): string {
    const mechanism = hint.mechanism ?? { type: 'generic', handled: true };
    let result: ReturnType<typeof exceptionsFromError>;
    try {
      result = exceptionsFromError(error, mechanism, this.frameOptions);
    } catch {
      // A hostile error (throwing getters, a Proxy) must never turn into an SDK error in the app.
      result = { values: [{ type: 'Error', value: '[unserializable error]', mechanism }] };
    }
    const event: BeaconEvent = { level: 'error', exception: { values: result.values } };
    if (result.serialized !== undefined) event.extra = { __serialized__: result.serialized };
    return this.captureEvent(event, scope, context, {
      ...hint,
      originalException: error,
      mechanism,
    });
  }

  captureMessage(
    message: string,
    scope: Scope,
    level: Level = 'info',
    context?: CaptureContext,
    hint: EventHint = {},
  ): string {
    return this.captureEvent({ message: String(message), level }, scope, context, hint);
  }

  /** Processes and sends an event in the background. Returns its event id at once. */
  captureEvent(
    event: BeaconEvent,
    scope: Scope,
    context?: CaptureContext,
    hint: EventHint = {},
  ): string {
    // Only Beacon's id format is used: an id also names files in the Node queue.
    const candidate = event.event_id ?? (this.options.generateEventId ?? uuid4)();
    const eventId = EVENT_ID.test(candidate) ? candidate : uuid4();
    event.event_id = eventId;
    if (!this.isActive()) return eventId;
    this.track(this.process(event, eventId, scope.clone().applyContext(context), hint));
    return eventId;
  }

  private track(task: Promise<unknown>): void {
    const tracked = task.then(
      () => undefined,
      (error: unknown) => this.log(`event processing failed: ${String(error)}`),
    );
    this.tasks.add(tracked);
    void tracked.finally(() => this.tasks.delete(tracked));
  }

  private async process(
    input: BeaconEvent,
    eventId: string,
    scope: Scope,
    hint: EventHint,
  ): Promise<void> {
    const options = this.options;
    const sampleRate = options.sampleRate ?? 1;
    if (sampleRate < 1 && !(this.random() < sampleRate)) return this.discard('sample_rate');
    let event: BeaconEvent | null = input;
    event.timestamp ??= this.now() / 1000;
    event.platform = this.platform.platform;
    event.environment ??= options.environment ?? 'production';
    if (options.release !== undefined) event.release ??= options.release;
    if (options.dist !== undefined) event.dist ??= options.dist;
    if (options.serverName !== undefined) event.server_name ??= options.serverName;
    if (hint.logger !== undefined) event.logger ??= hint.logger;
    event.sdk = {
      name: this.platform.sdkName,
      version: this.platform.sdkVersion,
      integrations: this.integrations.map((integration) => integration.name),
    };
    scope.applyToEvent(event);
    if (options.normalizeFilename) {
      for (const value of event.exception?.values ?? []) {
        for (const frame of value.stacktrace?.frames ?? [])
          frame.filename = options.normalizeFilename(frame);
      }
    }
    for (const integration of this.integrations) {
      if (!integration.processEvent) continue;
      event = integration.processEvent(event, hint, this);
      if (!event) return this.discard('event_processor');
    }
    if (this.isFiltered(event)) return this.discard('event_processor');
    if (options.scrubber !== false) event = (options.scrubber ?? defaultScrubber)(event);
    if (options.beforeSend) {
      event = await options.beforeSend(event, hint);
      if (!event) return this.discard('before_send');
      event.event_id = eventId;
    }
    expandFingerprint(event);
    stripIp(event);
    applyCaps(event, this.maxBreadcrumbs);
    if (!this.allowEvent(event)) return this.discard('self_throttle');
    const header = this.envelopeHeader(eventId);
    const fit = fitEvent(event, this.capBytes - ENVELOPE_OVERHEAD);
    if (!fit) return this.discard('payload_too_large');
    await this.dispatch({
      id: eventId,
      createdAt: this.now(),
      category: 'error',
      eventId,
      header,
      items: [{ type: 'event', payload: fit.line }],
    });
  }

  /** Inbound filters: `ignoreErrors`, `denyUrls`, `allowUrls` and `Script error.` without a stack. */
  private isFiltered(event: BeaconEvent): boolean {
    const values = event.exception?.values ?? [];
    const last = values[values.length - 1];
    const candidates: string[] = [];
    if (event.message !== undefined) candidates.push(String(event.message));
    if (last) candidates.push(last.value, `${last.type}: ${last.value}`);
    const ignore = [
      ...(this.platform.defaultIgnoreErrors ?? []),
      ...(this.options.ignoreErrors ?? []),
    ];
    if (candidates.some((text) => matchesAny(text, ignore))) return true;
    const frames = last?.stacktrace?.frames ?? [];
    if (!frames.length && candidates.some((text) => /^(?:\w+: )?Script error\.?$/.test(text)))
      return true;
    const url = frames[frames.length - 1]?.abs_path;
    if (url === undefined) return false;
    if (this.options.denyUrls && matchesAny(url, this.options.denyUrls)) return true;
    return !!this.options.allowUrls?.length && !matchesAny(url, this.options.allowUrls);
  }

  /** Self-throttle (contract §4.6): identical events, events per session, then the request budget. */
  private allowEvent(event: BeaconEvent): boolean {
    const now = this.now();
    const key = dedupeKey(event);
    const last = this.identical.get(key);
    if (last !== undefined && now - last < this.platform.identicalWindowMs) return false;
    const perSession = this.options.maxEventsPerSession ?? this.platform.maxEventsPerSession;
    if (perSession !== undefined && this.sessionEvents >= perSession) return false;
    if (!this.throttle.take()) return false;
    this.identical.delete(key);
    this.identical.set(key, now);
    if (this.identical.size > 100) this.identical.delete(this.identical.keys().next().value!);
    this.sessionEvents++;
    return true;
  }

  private envelopeHeader(eventId?: string): Record<string, unknown> {
    const header: Record<string, unknown> = eventId ? { event_id: eventId } : {};
    header['sdk'] = { name: this.platform.sdkName, version: this.platform.sdkVersion };
    return { ...header, ...this.authProvider.envelopeHeader?.(this.dsn!) };
  }

  /** Counts a discarded event for the next `client_report`. */
  discard(reason: DiscardReason, category: Category = 'error', quantity = 1): void {
    this.options.onOutcome?.({ type: 'dropped', reason });
    this.log(`event dropped (${reason})`);
    if (this.options.sendClientReports === false) return;
    const key = `${reason}:${category}`;
    this.discards.set(key, (this.discards.get(key) ?? 0) + quantity);
    if (!this.reportTimer) {
      const wait = Math.max(0, this.lastReportAt + REPORT_INTERVAL_MS - this.now());
      this.reportTimer = schedule(() => {
        this.reportTimer = undefined;
        this.track(this.sendClientReport(false));
      }, wait);
    }
  }

  /** Sends the pending `client_report` in its own envelope (at most once per 60 s, and on unload). */
  async sendClientReport(unload: boolean): Promise<void> {
    if (!this.discards.size || !this.dsn) return;
    const now = this.now();
    const blocked = Math.max(this.blockedUntil, this.disabledUntil);
    if (now < blocked || (!this.throttle.take() && !unload)) {
      if (!this.reportTimer && !this.closed) {
        this.reportTimer = schedule(
          () => {
            this.reportTimer = undefined;
            this.track(this.sendClientReport(false));
          },
          Math.max(blocked - now, REPORT_INTERVAL_MS),
        );
      }
      return;
    }
    const discarded = [...this.discards].map(([key, quantity]) => {
      const [reason, category] = key.split(':');
      return { reason, category, quantity };
    });
    this.discards.clear();
    this.lastReportAt = now;
    await this.dispatch(
      {
        id: uuid4(),
        createdAt: now,
        category: 'internal',
        header: this.envelopeHeader(),
        items: [
          {
            type: 'client_report',
            payload: serializeLine({ timestamp: now / 1000, discarded_events: discarded }),
          },
        ],
      },
      unload,
    );
  }

  private async dispatch(
    envelope: QueuedEnvelope,
    unload = false,
    fromQueue = false,
  ): Promise<SendOutcome> {
    const now = this.now();
    if (now < this.disabledUntil) return 'dropped';
    if (now < this.blockedUntil) {
      if (!fromQueue) return this.enqueue(envelope, 'ratelimit_backoff');
      // A drain timer can fire a little before the deadline: try again at the deadline instead of stalling.
      this.scheduleDrain(this.blockedUntil - now);
      return 'queued';
    }
    if (this.inFlight >= this.platform.inFlightCap) {
      if (fromQueue) return 'queued';
      this.discard('queue_overflow', envelope.category);
      return 'dropped';
    }
    const body = encodeEnvelope(
      { ...envelope.header, sent_at: new Date(now).toISOString() },
      envelope.items,
    );
    this.inFlight++;
    let result: TransportResult;
    try {
      result = await this.transport!.send({
        url: this.dsn!.envelopeUrl(),
        headers: { ...this.headers },
        body,
        category: envelope.category,
        ...(envelope.eventId ? { eventId: envelope.eventId } : {}),
        ...(unload ? { unload } : {}),
      });
    } finally {
      this.inFlight--;
    }
    return this.handleResult(result, envelope, fromQueue, byteLength(body));
  }

  private handleResult(
    result: TransportResult,
    envelope: QueuedEnvelope,
    fromQueue: boolean,
    bytes: number,
  ): SendOutcome | Promise<SendOutcome> {
    const now = this.now();
    if (result.kind === 'ok') {
      this.failures = 0;
      this.opaqueFailures = 0;
      if (envelope.eventId)
        this.options.onOutcome?.({ type: 'captured', eventId: envelope.eventId });
      return 'sent';
    }
    if (result.status) this.options.onOutcome?.({ type: 'error', status: result.status });
    if (result.kind === 'retry') {
      this.failures++;
      this.networkBlocked = result.reason === 'network';
      if (result.reason === 'network') {
        this.opaqueFailures++;
        if (this.opaqueFailures >= 3 && this.platform.isOnline?.() === true) {
          this.disable(
            '3 consecutive opaque failures while online: the origin is probably refused',
          );
        }
      } else {
        this.opaqueFailures = 0;
      }
      if (result.rateLimit) this.lastRateLimit = result.rateLimit;
      const delay = Math.min(
        MAX_RETRY_AFTER_MS,
        Math.max(result.afterMs, backoffDelay(this.failures, this.random)),
      );
      this.blockedUntil = Math.max(this.blockedUntil, now + delay);
      this.log(
        `request deferred (${result.reason}${result.rateLimit ? `, ${result.rateLimit}` : ''}) for ${delay} ms`,
      );
      this.scheduleDrain(this.blockedUntil - now);
      if (fromQueue) return 'queued';
      const reason =
        result.reason === 'ratelimit' || result.reason === 'quota'
          ? 'ratelimit_backoff'
          : 'network_error';
      return this.enqueue(envelope, reason);
    }
    if (result.reason === 'unauthorized' || result.reason === 'forbidden') {
      this.disable(`Beacon answered ${result.reason}`);
    } else if (result.reason === 'too_large') {
      this.capBytes = Math.min(this.capBytes, Math.floor(bytes / 2));
      this.discard('payload_too_large', envelope.category);
    } else {
      this.log(`envelope dropped (${result.reason})`);
    }
    return 'dropped';
  }

  private disable(why: string): void {
    this.disabledUntil = this.now() + DISABLE_MS;
    this.warn('disabled', `${why}; Beacon is disabled for 1 h`);
  }

  private async enqueue(envelope: QueuedEnvelope, reason: DiscardReason): Promise<SendOutcome> {
    if (!this.queue || envelope.category === 'internal') {
      this.discard(reason, envelope.category);
      return 'dropped';
    }
    const evicted = await this.queue.push(envelope);
    if (evicted) this.discard('queue_overflow', 'error', evicted);
    this.scheduleDrain(Math.max(0, this.blockedUntil - this.now()));
    return 'queued';
  }

  private scheduleDrain(delay: number): void {
    if (!this.queue || this.closed) return;
    clearTimeout(this.drainTimer);
    this.drainTimer = schedule(() => this.track(this.drainQueue(false)), delay);
  }

  /**
   * Re-sends queued envelopes one at a time, oldest first, keeping their `event_id`. With `online` (the browser's
   * `online` event), a wait caused by a network failure is lifted first; a rate-limit wait never is.
   */
  async drainQueue(unload: boolean, online = false): Promise<void> {
    if (online && this.networkBlocked) {
      this.blockedUntil = 0;
      this.networkBlocked = false;
    }
    if (!this.queue || this.draining || !this.dsn) return;
    this.draining = true;
    try {
      for (;;) {
        const next = await this.queue.peek();
        if (!next) break;
        const outcome = await this.dispatch(next, unload, true);
        if (outcome === 'queued') break;
        await this.queue.remove(next.id);
      }
    } finally {
      this.draining = false;
    }
  }

  /** Waits for pending events and requests. Resolves `true` when everything settled within the timeout. */
  async flush(timeoutMs = 2000, unload = false): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = schedule(() => resolve(false), timeoutMs);
    });
    const started = this.now();
    const work = (async (): Promise<boolean> => {
      while (this.tasks.size) await Promise.allSettled([...this.tasks]);
      if (unload) await this.sendClientReport(true);
      await this.drainQueue(unload);
      return this.transport
        ? this.transport.flush(Math.max(0, timeoutMs - (this.now() - started)))
        : true;
    })();
    const result = await Promise.race([work, timeout]);
    clearTimeout(timer);
    return result;
  }

  /** Stops accepting events, removes the handlers, sends the pending client report and flushes. */
  async close(timeoutMs = 2000): Promise<boolean> {
    if (this.closed) return true;
    this.teardown();
    if (this.dsn) this.track(this.sendClientReport(true));
    this.closed = true;
    clearTimeout(this.reportTimer);
    clearTimeout(this.drainTimer);
    return this.flush(timeoutMs);
  }

  /** Removes every integration's handlers (synchronous). */
  teardown(): void {
    for (const integration of this.integrations) integration.teardown?.();
  }
}
