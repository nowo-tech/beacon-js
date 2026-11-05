import { spawn } from 'node:child_process';
import { createMockBeacon, PROJECT_ID } from '@beacon-js/mock-beacon';

export const DSN_PATH = `/${PROJECT_ID}`;

export async function startMock(overrides = {}) {
  const mock = createMockBeacon(overrides);
  const base = await mock.listen();
  const host = base.replace('http://', '');
  return {
    mock,
    base,
    dsn: `http://test-public:test-secret-not-real@${host.replace('127.0.0.1', 'localhost')}${DSN_PATH}`,
  };
}

export function events(mock) {
  return mock.requests
    .filter((r) => r.envelope)
    .flatMap((r) =>
      r.envelope.items
        .filter((i) => i.header.type === 'event')
        .map((i) => ({ request: r, event: i.payload })),
    );
}

export async function waitFor(check, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export function run(script, env) {
  const child = spawn(
    process.execPath,
    [new URL(`../fixtures/${script}`, import.meta.url).pathname],
    {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const exited = new Promise((resolve) =>
    child.on('exit', (code, signal) => resolve({ code, signal, stdout, stderr, at: Date.now() })),
  );
  return { child, exited, output: () => stdout };
}
