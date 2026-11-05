// Builds one workspace package (run from the package directory): esbuild bundles, tsc declarations and an
// API Extractor roll-up and report per entry. Configuration comes from package.json "beaconBuild".
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const cwd = process.cwd();
const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
const config = pkg.beaconBuild;
const define = { __BEACON_VERSION__: JSON.stringify(pkg.version) };
const external = [
  pkg.name,
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

rmSync(join(cwd, 'dist'), { recursive: true, force: true });

const common = {
  bundle: true,
  platform: config.platform ?? 'neutral',
  target: config.target ?? 'es2020',
  external,
  define,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
};
// ESM: one build for every entry. Entries share code through package self-imports, never chunks.
const esmEntries = config.entries.filter((entry) => entry.formats.includes('esm'));
if (esmEntries.length) {
  await build({
    ...common,
    entryPoints: Object.fromEntries(esmEntries.map((entry) => [entry.out, join(cwd, entry.in)])),
    outdir: join(cwd, 'dist'),
    outExtension: { '.js': '.mjs' },
    format: 'esm',
  });
}
for (const entry of config.entries.filter((item) => item.formats.includes('cjs'))) {
  await build({
    ...common,
    entryPoints: [join(cwd, entry.in)],
    outfile: join(cwd, 'dist', `${entry.out}.cjs`),
    format: 'cjs',
  });
}

// Self-contained delivery builds (browser): IIFE and ESM, minified, with linked source maps.
for (const delivery of config.delivery ?? []) {
  await build({
    entryPoints: [join(cwd, delivery.in)],
    outfile: join(cwd, 'dist', 'delivery', delivery.out),
    bundle: true,
    minify: true,
    format: delivery.format,
    ...(delivery.globalName ? { globalName: delivery.globalName } : {}),
    // Self-imports (e.g. the element importing the package entry) resolve to the same sources: one copy.
    alias: { [pkg.name]: join(cwd, config.entries[0].in) },
    platform: 'browser',
    target: config.target ?? 'es2020',
    define,
    sourcemap: 'linked',
    sourcesContent: true,
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'warning',
  });
}

const tsc = require.resolve('typescript/bin/tsc');
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { stdio: 'inherit', cwd });

const { Extractor, ExtractorConfig } = await import('@microsoft/api-extractor');
const localBuild = !process.env.CI;
mkdirSync(join(cwd, 'etc'), { recursive: true });
for (const entry of config.entries) {
  const reportName =
    entry.out === 'index' ? pkg.name.split('/').pop() : `${pkg.name.split('/').pop()}-${entry.out}`;
  const extractorConfig = ExtractorConfig.prepare({
    configObject: {
      projectFolder: cwd,
      mainEntryPointFilePath: resolve(
        cwd,
        'dist/types',
        entry.in.replace(/^src\//, '').replace(/\.ts$/, '.d.ts'),
      ),
      compiler: { tsconfigFilePath: resolve(cwd, 'tsconfig.build.json') },
      apiReport: {
        enabled: true,
        reportFileName: `${reportName}.api.md`,
        reportFolder: resolve(cwd, 'etc'),
        reportTempFolder: resolve(cwd, 'temp'),
      },
      docModel: { enabled: false },
      dtsRollup: { enabled: true, untrimmedFilePath: resolve(cwd, 'dist', `${entry.out}.d.ts`) },
      tsdocMetadata: { enabled: false },
      messages: {
        extractorMessageReporting: {
          default: { logLevel: 'warning' },
          'ae-missing-release-tag': { logLevel: 'none' },
          'ae-forgotten-export': { logLevel: 'none' },
          'ae-undocumented': { logLevel: 'none' },
        },
        tsdocMessageReporting: { default: { logLevel: 'none' } },
      },
    },
    configObjectFullPath: join(cwd, 'api-extractor.json'),
    packageJsonFullPath: join(cwd, 'package.json'),
  });
  const result = Extractor.invoke(extractorConfig, { localBuild, showVerboseMessages: false });
  if (!result.succeeded) {
    console.error(
      `API Extractor failed for ${entry.in} (${result.errorCount} errors, ${result.warningCount} warnings)`,
    );
    process.exit(1);
  }
  if (entry.formats.includes('cjs')) {
    copyFileSync(join(cwd, 'dist', `${entry.out}.d.ts`), join(cwd, 'dist', `${entry.out}.d.cts`));
  }
}
rmSync(join(cwd, 'dist', 'types'), { recursive: true, force: true });
rmSync(join(cwd, 'temp'), { recursive: true, force: true });
writeFileSync(join(cwd, 'dist', '.build-stamp'), `${pkg.name}@${pkg.version}\n`);
