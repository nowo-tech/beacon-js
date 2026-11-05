import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Node filenames are relative to `appRoot` (default `process.cwd()`), so that `src/…` matches Beacon's
 * `src|app|tests` grouping rule (contract §3.5). `abs_path` keeps the original path.
 */
export function makeNodeFilenameNormalizer(appRoot: string): (absPath: string) => string {
  return (absPath) => {
    let path = absPath;
    if (path.startsWith('file://')) {
      try {
        path = fileURLToPath(path);
      } catch {
        return absPath;
      }
    }
    if (!isAbsolute(path)) return path;
    const rel = relative(appRoot, path);
    return rel.startsWith('..') || isAbsolute(rel)
      ? path.split(sep).join('/')
      : rel.split(sep).join('/');
  };
}
