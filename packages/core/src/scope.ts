import { normalize, EXTRA_LIMITS } from './normalize.js';
import type { BeaconEvent, Breadcrumb, CaptureContext, Level, User } from './types.js';

/** Data merged into every event captured while the scope is active. */
export class Scope {
  user: User | undefined;
  tags: Record<string, string> = {};
  extra: Record<string, unknown> = {};
  contexts: Record<string, Record<string, unknown>> = {};
  level: Level | undefined;
  fingerprint: string[] | undefined;
  breadcrumbs: Breadcrumb[] = [];
  /** Request data (Node request isolation). */
  request: BeaconEvent['request'];

  clone(): Scope {
    const scope = new Scope();
    scope.user = this.user ? { ...this.user } : undefined;
    scope.tags = { ...this.tags };
    scope.extra = { ...this.extra };
    scope.contexts = { ...this.contexts };
    scope.level = this.level;
    scope.fingerprint = this.fingerprint ? [...this.fingerprint] : undefined;
    scope.breadcrumbs = [...this.breadcrumbs];
    scope.request = this.request;
    return scope;
  }

  setUser(user: User | null): this {
    this.user = user ? { ...user } : undefined;
    return this;
  }

  setTag(key: string, value: string): this {
    this.tags[key] = String(value);
    return this;
  }

  setTags(tags: Record<string, string>): this {
    for (const [key, value] of Object.entries(tags)) this.setTag(key, value);
    return this;
  }

  setExtra(key: string, value: unknown): this {
    this.extra[key] = value;
    return this;
  }

  setContext(name: string, context: Record<string, unknown> | null): this {
    if (context) this.contexts[name] = context;
    else delete this.contexts[name];
    return this;
  }

  setLevel(level: Level | undefined): this {
    this.level = level;
    return this;
  }

  setFingerprint(fingerprint: string[] | undefined): this {
    this.fingerprint = fingerprint;
    return this;
  }

  addBreadcrumb(crumb: Breadcrumb, max: number): this {
    this.breadcrumbs.push(crumb);
    if (this.breadcrumbs.length > max) this.breadcrumbs.splice(0, this.breadcrumbs.length - max);
    return this;
  }

  /** Applies per-call capture data (it wins over the scope). */
  applyContext(context: CaptureContext | undefined): this {
    if (!context) return this;
    if (context.tags) this.setTags(context.tags);
    if (context.extra) Object.assign(this.extra, context.extra);
    if (context.contexts) Object.assign(this.contexts, context.contexts);
    if (context.user) this.setUser(context.user);
    if (context.level) this.level = context.level;
    if (context.fingerprint) this.fingerprint = context.fingerprint;
    return this;
  }

  /** Merges the scope into a fresh copy of its data on the event. Event fields win over scope fields. */
  applyToEvent(event: BeaconEvent): BeaconEvent {
    if (this.user && !event.user) event.user = { ...this.user };
    event.tags = { ...this.tags, ...event.tags };
    event.extra = {
      ...(normalize(this.extra, EXTRA_LIMITS) as Record<string, unknown>),
      ...event.extra,
    };
    event.contexts = {
      ...(normalize(this.contexts, EXTRA_LIMITS) as BeaconEvent['contexts']),
      ...event.contexts,
    };
    if (this.level) event.level = this.level;
    if (this.fingerprint && !event.fingerprint) event.fingerprint = [...this.fingerprint];
    if (this.request && !event.request) event.request = { ...this.request };
    if (this.breadcrumbs.length) {
      event.breadcrumbs = {
        values: [
          ...this.breadcrumbs.map((crumb) => ({ ...crumb })),
          ...(event.breadcrumbs?.values ?? []),
        ],
      };
    }
    if (!Object.keys(event.tags).length) delete event.tags;
    if (!Object.keys(event.extra).length) delete event.extra;
    if (!Object.keys(event.contexts).length) delete event.contexts;
    return event;
  }
}
