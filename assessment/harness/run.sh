#!/usr/bin/env bash
# Run every evaluation layer for the current checkout and save results under assessment/results/<label>/.
#   assessment/harness/run.sh <label>          e.g. baseline, reference, model-a, model-b
# Layers: (1) the packages' existing tests (incl. any tests the output added), (2) this harness.
# Layer (3), the real-time repro scripts against a rebuilt dist, is run separately: see phase1/README.md.
set -u
PIN=b90fc58acae6212a5eefcc92ddfbaf1117ba08e9
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="${1:?usage: run.sh <label>}"
OUT="$ROOT/assessment/results/$LABEL"
strip() { sed 's/\x1b\[[0-9;]*m//g'; }

rm -rf "$OUT" && mkdir -p "$OUT"
cd "$ROOT"
unset NODE_OPTIONS
{
  echo "label:  $LABEL"
  echo "date:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "head:   $(git rev-parse HEAD) ($(git rev-parse --abbrev-ref HEAD))"
  echo "node:   $(node --version)"
  echo "changes vs pin, outside assessment/:"
  git diff "$PIN" --stat -- . ':(exclude)assessment'
  git status --short -- . ':(exclude)assessment'
} > "$OUT/context.txt"

echo "== layer 1: existing package tests"
(cd packages/rds-signer && yarn test 2>&1) | strip > "$OUT/tests-rds-signer.txt"
(cd packages-internal/credential-provider-node && yarn test 2>&1) | strip > "$OUT/tests-credential-provider-node.txt"
grep -E "Test Files|Tests " "$OUT/tests-rds-signer.txt" | sed 's/^/  rds-signer: /'
grep -E "Test Files|Tests " "$OUT/tests-credential-provider-node.txt" | sed 's/^/  credential-provider-node: /'

echo "== layer 2: harness"
HARNESS_INFO_DIR="$OUT/info" yarn vitest run -c assessment/harness/vitest.config.mts \
  --reporter=verbose --reporter=json --outputFile.json="$OUT/harness.json" 2>&1 | strip > "$OUT/harness.txt"
node assessment/harness/summarize.cjs "$OUT"
echo "results: $OUT"
