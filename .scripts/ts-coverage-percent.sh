#!/usr/bin/env sh
# Print one global TS coverage percentage (REQ-TEST-009): the minimum of statements, branches, functions and lines
# over every packages/*/coverage/coverage-summary.json (Vitest json-summary reporter). Run after `pnpm test`.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "${ROOT}"

found=0
for f in packages/*/coverage/coverage-summary.json; do
  [ -f "$f" ] && found=1
done
if [ "$found" -eq 0 ]; then
  echo "ERROR: no packages/*/coverage/coverage-summary.json; run the tests with coverage first." >&2
  exit 1
fi

node -e '
const fs = require("fs");
const files = process.argv.slice(1).filter((f) => fs.existsSync(f));
const sum = { statements: [0, 0], branches: [0, 0], functions: [0, 0], lines: [0, 0] };
for (const f of files) {
  const total = JSON.parse(fs.readFileSync(f, "utf8")).total;
  for (const k of Object.keys(sum)) { sum[k][0] += total[k].covered; sum[k][1] += total[k].total; }
}
const pct = (k) => (sum[k][1] === 0 ? 100 : (100 * sum[k][0]) / sum[k][1]);
const min = Math.min(...Object.keys(sum).map(pct));
console.log(`TS coverage: ${min.toFixed(2)}% (min of statements, branches, functions, lines; ${files.length} packages)`);
' packages/*/coverage/coverage-summary.json
