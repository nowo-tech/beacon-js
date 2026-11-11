#!/usr/bin/env node
// Starts the mock Beacon (and, optionally, a static file server for e2e pages on another origin).
// Usage: mock-beacon --port 4200 [--origin http://localhost:4100] [--static <dir> --static-port 4100] [--legacy] [--legacy-only-paths]
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { createMockBeacon } from './server.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const origins = args.flatMap((arg, i) => (arg === '--origin' ? [args[i + 1]] : []));
const mock = createMockBeacon({
  allowedOrigins: origins,
  mode: args.includes('--legacy') ? 'legacy' : 'current',
  paths: args.includes('--legacy-only-paths') ? 'legacy-only' : 'all',
});
const port = Number(option('port', '4200'));
const host = option('host', '127.0.0.1');
await mock.listen(port, host);
console.log(`mock-beacon listening on http://${host}:${port}`);

const staticDir = option('static');
if (staticDir) {
  const root = resolve(staticDir);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.map': 'application/json',
    '.css': 'text/css',
    '.json': 'application/json',
  };
  const extraRoots = args
    .flatMap((arg, i) => (arg === '--mount' ? [args[i + 1]] : []))
    .map((spec) => {
      const [prefix, dir] = spec.split('=');
      return { prefix, dir: resolve(dir) };
    });
  const resolveFile = (pathname) => {
    const mount = extraRoots.find((m) => pathname.startsWith(m.prefix));
    const base = mount ? mount.dir : root;
    const rel = mount ? pathname.slice(mount.prefix.length) : pathname;
    const file = normalize(join(base, rel === '/' || rel === '' ? 'index.html' : rel));
    return file.startsWith(base) && existsSync(file) && statSync(file).isFile() ? file : undefined;
  };
  const files = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://static');
    const file = resolveFile(url.pathname);
    if (!file) {
      res.writeHead(404);
      return res.end('not found');
    }
    const headers = {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    };
    const csp = url.searchParams.get('csp');
    if (csp) headers['Content-Security-Policy'] = csp;
    res.writeHead(200, headers);
    if (extname(file) !== '.html') return createReadStream(file).pipe(res);
    // `%%SRI:/sdk/beacon.min.js%%` in a page becomes the file's sha384 integrity (for the SRI + CSP scenario).
    const html = readFileSync(file, 'utf8').replace(/%%SRI:([^%]+)%%/g, (_, path) => {
      const target = resolveFile(path);
      return target
        ? `sha384-${createHash('sha384').update(readFileSync(target)).digest('base64')}`
        : 'missing';
    });
    res.end(html);
  });
  const staticPort = Number(option('static-port', '4100'));
  files.listen(staticPort, host, () => console.log(`static files on http://${host}:${staticPort}`));
}
