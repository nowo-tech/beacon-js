import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Integration, StackFrame } from '@nowo-tech/beacon-core';

const CONTEXT = 5;
const MAX_FILE_BYTES = 1024 * 1024;
const CACHE_SIZE = 100;

/**
 * Source context for `in_app` frames (contract §3.4): 5 lines before and after, read from disk, with an LRU cache of
 * 100 files and a 1 MiB cap per file. Files that cannot be read are remembered as missing.
 */
export function contextLinesIntegration(): Integration {
  const cache = new Map<string, string[] | null>();
  const lines = (absPath: string): string[] | null => {
    if (cache.has(absPath)) {
      const hit = cache.get(absPath) as string[] | null;
      cache.delete(absPath);
      cache.set(absPath, hit);
      return hit;
    }
    let result: string[] | null = null;
    try {
      const path = absPath.startsWith('file://') ? fileURLToPath(absPath) : absPath;
      if (isAbsolute(path) && statSync(path).size <= MAX_FILE_BYTES)
        result = readFileSync(path, 'utf8').split(/\r?\n/);
    } catch {
      result = null;
    }
    cache.set(absPath, result);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    return result;
  };
  const addContext = (frame: StackFrame): void => {
    if (!frame.in_app || !frame.abs_path || !frame.lineno) return;
    const source = lines(frame.abs_path);
    const index = frame.lineno - 1;
    if (!source || index >= source.length) return;
    frame.pre_context = source.slice(Math.max(0, index - CONTEXT), index);
    frame.context_line = source[index] as string;
    frame.post_context = source.slice(index + 1, index + 1 + CONTEXT);
  };
  return {
    name: 'ContextLines',
    processEvent(event) {
      for (const value of event.exception?.values ?? [])
        value.stacktrace?.frames.forEach(addContext);
      return event;
    },
  };
}
