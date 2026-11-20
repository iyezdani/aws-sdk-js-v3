#!/usr/bin/env bash
# Phase 3 prep (run-protocol.md): two identical clean clones of the fork at the pin, installed and built.
set -u
PIN=b90fc58acae6212a5eefcc92ddfbaf1117ba08e9
FORK=https://github.com/iyezdani/aws-sdk-js-v3.git
SHIM=D:/ToptalAssessment/aws-sdk-js-v3/assessment/phase1/tooling/win-spawn-shim.cjs
A=/d/src/a/aws-sdk-js-v3
B=/d/src/b/aws-sdk-js-v3

step() { echo "[$(date +%H:%M:%S)] $*"; }
mkdir -p /d/src/a /d/src/b

step "clone A from the fork (main only)"
git clone -q --single-branch --branch main "$FORK" "$A" || exit 1
step "clone B from A (--no-local: reachable objects of main only), origin -> fork"
git clone -q --no-local --single-branch --branch main "$A" "$B" || exit 1
git -C "$B" remote set-url origin "$FORK" && git -C "$B" fetch -q origin main && git -C "$B" branch -q -u origin/main main

prep() {
  local d=$1
  cd "$d" || return 1
  [ "$(git rev-parse HEAD)" = "$PIN" ] || { echo "HEAD mismatch in $d: $(git rev-parse HEAD)"; return 1; }
  step "$d: yarn install"
  yarn install > /dev/null 2>&1 || { echo "install failed"; return 1; }
  step "$d: build rds-signer closure"
  NODE_OPTIONS="--require $SHIM" yarn workspaces foreach --from @aws-sdk/rds-signer -R -t -p -j 4 run build > build.prep.log 2>&1 \
    || { echo "build failed (see $d/build.prep.log)"; return 1; }
  rm -f build.prep.log
  step "$d: rds-signer tests"
  (cd packages/rds-signer && yarn test 2>&1 | grep -E "Tests ")
  step "$d: HEAD $(git rev-parse HEAD), branches: $(git branch -a | tr -d ' \n'), dirty files: $(git status --short | wc -l)"
}
prep "$A" || exit 1
prep "$B" || exit 1
step "done"
