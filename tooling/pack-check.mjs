// Packs every publishable package and checks the tarball with publint and @arethetypeswrong/cli (contract §2.1).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'beacon-pack-'));
let failed = false;
try {
  for (const dir of readdirSync(join(root, 'packages'), { withFileTypes: true }).filter((entry) =>
    entry.isDirectory(),
  )) {
    const cwd = join(root, 'packages', dir.name);
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    if (pkg.private) continue;
    execFileSync('pnpm', ['pack', '--pack-destination', out], { cwd, stdio: 'ignore' });
    const tarball = join(
      out,
      readdirSync(out).find((file) => file.startsWith(pkg.name.replace('@', '').replace('/', '-'))),
    );
    console.log(`\n== ${pkg.name}@${pkg.version}`);
    const files = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    const leaked = files.filter((file) =>
      /\/(src|test|coverage)\/|\.test\.|tsconfig|vitest\.config/.test(file),
    );
    if (leaked.length) {
      console.error(`unexpected files in the tarball: ${leaked.join(', ')}`);
      failed = true;
    }
    try {
      execFileSync('pnpm', ['exec', 'publint', 'run', tarball, '--strict'], {
        cwd: root,
        stdio: 'inherit',
      });
      const profile = pkg.exports?.['.']?.require ? [] : ['--profile', 'esm-only'];
      execFileSync('pnpm', ['exec', 'attw', tarball, ...profile], { cwd: root, stdio: 'inherit' });
    } catch {
      failed = true;
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
