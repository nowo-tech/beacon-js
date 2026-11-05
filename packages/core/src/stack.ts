import type { StackFrame, Stacktrace } from './types.js';
import { matchesAny } from './utils.js';

/** A frame as parsed from `Error.stack`, before `in_app` and filename normalisation. */
export interface RawFrame {
  function: string;
  abs_path: string;
  lineno?: number;
  colno?: number;
}

export const MAX_FRAMES = 64;
const UNKNOWN_FUNCTION = '?';
const LOCATION = /^(.*?):(\d+)(?::(\d+))?$/;
const V8_EVAL = /\((\S*):(\d+):(\d+)\)/;
const GECKO_EVAL = /^(\S+) line (\d+)(?: > \w+(?: line \d+)?)* > (?:eval|Function)/;

function location(fn: string, loc: string): RawFrame {
  const match = LOCATION.exec(loc);
  if (!match) return { function: fn, abs_path: loc };
  const frame: RawFrame = { function: fn, abs_path: match[1]!, lineno: Number(match[2]) };
  if (match[3] !== undefined) frame.colno = Number(match[3]);
  return frame;
}

/** V8 (Chrome, Edge, Node): `    at fn (url:line:col)`, `at async fn`, `at new Foo`, `eval at`, `native`. */
export function parseV8Line(line: string): RawFrame | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('at ')) return undefined;
  let rest = trimmed.slice(3);
  if (rest.startsWith('async ')) rest = rest.slice(6);
  const open = rest.indexOf(' (');
  if (open === -1 || !rest.endsWith(')')) {
    return location(UNKNOWN_FUNCTION, rest);
  }
  const fn = rest.slice(0, open) || UNKNOWN_FUNCTION;
  let loc = rest.slice(open + 2, -1);
  if (loc.startsWith('eval at ')) {
    const inner = V8_EVAL.exec(loc);
    loc = inner ? `${inner[1]}:${inner[2]}:${inner[3]}` : loc;
  }
  if (loc.startsWith('address at ')) loc = loc.slice(11);
  return location(fn, loc);
}

/** SpiderMonkey (Firefox) and JSC (Safari): `fn@url:line:col`, `@url`, `global code@`, `[native code]`. */
export function parseGeckoLine(line: string): RawFrame | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  if (trimmed === '[native code]') return { function: UNKNOWN_FUNCTION, abs_path: '[native code]' };
  const at = trimmed.indexOf('@');
  if (at === -1) return undefined;
  const fn = trimmed.slice(0, at) || UNKNOWN_FUNCTION;
  const loc = trimmed.slice(at + 1);
  const evalMatch = GECKO_EVAL.exec(loc);
  if (evalMatch) return { function: fn, abs_path: evalMatch[1]!, lineno: Number(evalMatch[2]) };
  return location(fn, loc);
}

/** Parses `Error.stack` into raw frames, **newest first** as the engines print them. */
export function parseStack(stack: string): RawFrame[] {
  const lines = stack.split('\n');
  const isV8 = lines.some((line) => /^\s*at /.test(line));
  const frames: RawFrame[] = [];
  for (const line of lines) {
    const frame = isV8 ? parseV8Line(line) : parseGeckoLine(line);
    if (frame) frames.push(frame);
  }
  return frames;
}

export interface FrameOptions {
  normalizeFilename: (absPath: string) => string;
  inAppInclude?: ReadonlyArray<string | RegExp>;
  inAppExclude?: ReadonlyArray<string | RegExp>;
}

const NOT_IN_APP =
  /node_modules|^node:|^internal[/:]|-extension:\/\/|\[native code\]|^native$|^<anonymous>$/;
const SDK_FRAME = /[/\\@]beacon-(?:core|browser|node|express)[/\\@.-]|^__beacon/;

export function isSdkFrame(frame: RawFrame): boolean {
  return SDK_FRAME.test(frame.abs_path) || SDK_FRAME.test(frame.function);
}

export function isInApp(absPath: string, options: FrameOptions): boolean {
  if (options.inAppInclude && matchesAny(absPath, options.inAppInclude)) return true;
  if (options.inAppExclude && matchesAny(absPath, options.inAppExclude)) return false;
  return !NOT_IN_APP.test(absPath) && !SDK_FRAME.test(absPath);
}

/** Strips origin, query, hash and a content-hash segment: `https://x/assets/index-3f9a1c2b.js?v=1` → `/assets/index.js`. */
export function normalizeUrlFilename(absPath: string): string {
  let path = absPath.replace(/[?#].*$/, '');
  path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  return path.replace(/[-.][0-9a-f]{8,}(?=\.m?js$)/i, '');
}

/**
 * Turns raw frames (newest first) into Sentry frames (oldest first): SDK frames are removed from the top, `in_app` and
 * `filename` are set, and stacks over 64 frames keep the 32 oldest and the 32 newest.
 */
export function toStacktrace(
  raw: readonly RawFrame[],
  options: FrameOptions,
): Stacktrace | undefined {
  let start = 0;
  while (start < raw.length && isSdkFrame(raw[start]!)) start++;
  const frames: StackFrame[] = raw
    .slice(start)
    .reverse()
    .map((frame) => {
      // Script URL queries and fragments can carry signatures (`?X-Amz-Signature=…`): never kept (§5).
      const absPath = frame.abs_path.replace(/[?#].*$/, '');
      const out: StackFrame = {
        filename: options.normalizeFilename(absPath),
        abs_path: absPath,
        function: frame.function,
        in_app: isInApp(frame.abs_path, options),
      };
      if (frame.lineno !== undefined) out.lineno = frame.lineno;
      if (frame.colno !== undefined) out.colno = frame.colno;
      return out;
    });
  if (!frames.length) return undefined;
  return limitFrames(frames);
}

export function limitFrames(frames: StackFrame[], max = MAX_FRAMES): Stacktrace {
  if (frames.length <= max) return { frames };
  const half = max / 2;
  return {
    frames: [...frames.slice(0, half), ...frames.slice(frames.length - half)],
    frames_omitted: [half, frames.length - half],
  };
}
