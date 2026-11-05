/** Severity of an event or breadcrumb. */
export type Level = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

/** Which kind of request a transport call carries. */
export type Category = 'error' | 'transaction' | 'internal' | 'feedback';

/** One stack frame, in Sentry's field names. Frames are always ordered oldest first. */
export interface StackFrame {
  filename?: string;
  abs_path?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  module?: string;
  pre_context?: string[];
  context_line?: string;
  post_context?: string[];
}

export interface Stacktrace {
  frames: StackFrame[];
  frames_omitted?: [number, number];
}

export interface Mechanism {
  type: string;
  handled?: boolean;
  source?: string;
  exception_id?: number;
  parent_id?: number;
  is_exception_group?: boolean;
  data?: Record<string, unknown>;
}

export interface ExceptionValue {
  type: string;
  value: string;
  mechanism?: Mechanism;
  stacktrace?: Stacktrace;
}

export interface Breadcrumb {
  timestamp?: number;
  category?: string;
  type?: string;
  level?: Level;
  message?: string;
  data?: Record<string, unknown>;
}

export interface User {
  id?: string | number;
  username?: string;
  email?: string;
  /** Never sent: stripped as the last step before encoding, whatever its value. */
  ip_address?: string;
  [key: string]: unknown;
}

export interface RequestData {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  query_string?: string;
  cookies?: unknown;
  data?: unknown;
  env?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SdkInfo {
  name: string;
  version: string;
  integrations?: string[];
}

/** The event payload, a subset of Sentry's event schema (contract §3.3). */
export interface BeaconEvent {
  event_id?: string;
  timestamp?: number;
  platform?: string;
  level?: Level;
  logger?: string;
  release?: string;
  dist?: string;
  environment?: string;
  server_name?: string;
  message?: string;
  exception?: { values: ExceptionValue[] };
  breadcrumbs?: { values: Breadcrumb[] };
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: User;
  request?: RequestData;
  contexts?: Record<string, Record<string, unknown>>;
  sdk?: SdkInfo;
  fingerprint?: string[];
  transaction?: string;
  [key: string]: unknown;
}

/** Extra information about how an event was produced. */
export interface EventHint {
  originalException?: unknown;
  mechanism?: Mechanism;
  /** The integration that produced the event (becomes `logger`). */
  logger?: string;
  data?: Record<string, unknown>;
}

/** Per-call scope data for `captureException` / `captureMessage`. */
export interface CaptureContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  level?: Level;
  fingerprint?: string[];
  user?: User;
  contexts?: Record<string, Record<string, unknown>>;
}

/** Reasons a client report can count a discarded event for (contract §3.2). */
export type DiscardReason =
  | 'sample_rate'
  | 'before_send'
  | 'event_processor'
  | 'ratelimit_backoff'
  | 'queue_overflow'
  | 'network_error'
  | 'payload_too_large'
  | 'self_throttle';
