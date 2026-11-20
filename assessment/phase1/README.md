# Phase 1: setup and reproduction

The ground truth and the results are in `design-notes.md`. This file covers only how to rebuild and rerun.

## Pin

- **Repo:** `D:\ToptalAssessment\aws-sdk-js-v3`, at `b90fc58acae6212a5eefcc92ddfbaf1117ba08e9` (v3.1173.0).
- **Environment:** Windows 11, Git Bash, Node 20.20.0 (nvm; not on the PowerShell PATH), Yarn 4.17.1 (repo-pinned).

## Decisions (2026-11-19)

1. **Both models get repo access** (agentic coding tool), and both run the same way.
2. **The prompt does not mention #8358 or the expiry recheck.** Whether a model finds them on its own is part of the evaluation. This goes in the Phase 2 "left out of the prompt" note.
3. **Fork:** https://github.com/iyezdani/aws-sdk-js-v3 (public). In this clone, `origin` = the fork and `upstream` = aws/aws-sdk-js-v3. The fork's `main` was created at the pinned SHA. Nothing has been pushed yet.

**Isolation for Phase 3, which follows from decision 1:**

- Run each model in **its own fresh clone of the fork**, checked out at the pinned SHA, at a **different path from this clone**. Claude Code keys project memory by path, so a new path guarantees the run starts with none.
- Separate clones also mean neither model sees the other's changes or the Phase 2 harness branch. Keep that branch local, or push it only after Phase 3. Clone with `--single-branch`.
- Prepare both clones identically: `yarn install`, plus the same build state, so `yarn test` works out of the box in both.
- Without the shim, `yarn build` fails on Windows in both clones equally. How each model copes with that is itself observable.
- Afterwards, check each transcript for reads outside its clone, in particular of `D:\ToptalAssessment\aws-sdk-js-v3\assessment\`.
4. **All assessment material lives in `assessment/`** on the local `assessment` branch of this clone. It is not pushed until Phase 3 is done.
- If Claude Code with Opus 5.5 is one of the models, note that `~/.claude/settings.json` sets its default effort to `xhigh`. Record that as the effort setting, or override it explicitly.

## Build (run from Git Bash)

```sh
cd /d/ToptalAssessment/aws-sdk-js-v3
yarn install                       # full install; a focused install misses @tsconfig/node20
export NODE_OPTIONS="--require D:/ToptalAssessment/aws-sdk-js-v3/assessment/phase1/tooling/win-spawn-shim.cjs"
yarn workspaces foreach --from @aws-sdk/rds-signer -R -t -p -j 4 run build    # 17 packages, ~1 min
unset NODE_OPTIONS
```

Why the build is not just `yarn build:include:deps`: the repo's build tooling assumes POSIX. Three things break on Windows, and none of them touch the code under evaluation:

1. Turbo runs `prebuild`, which runs `scripts/validation/submodules-linter.js`. The linter splits paths on `/` and crashes. It also rewrites tracked files in `packages-internal/{core,nested-clients}` with LF line endings (a whitespace-only change; restore with `git checkout --`). Yarn 4 does not run `pre*` scripts, so `workspaces foreach ... run build` skips it.
2. `Inliner.js` calls `spawn("yarn")` without a shell, which fails with ENOENT on Windows.
3. `Inliner.js`'s rollup `external` predicate only recognises POSIX absolute paths.

`tooling/win-spawn-shim.cjs` handles 2 and 3 as a preload, without modifying the repo. **Check:** the resulting `dist-cjs` bundles for rds-signer, credential-provider-node and credential-providers are **byte-identical** (ignoring CRLF) to the published npm 3.1173.0 / 3.972.97 tarballs.

After any source change (for example, a model's patch), rebuild only what changed, then rerun:

```sh
export NODE_OPTIONS="--require D:/ToptalAssessment/aws-sdk-js-v3/assessment/phase1/tooling/win-spawn-shim.cjs"
(cd packages/rds-signer && yarn build)        # and/or packages-internal/credential-provider-node
unset NODE_OPTIONS
```

## Tests

```sh
(cd packages/rds-signer && yarn test)                              # baseline 14/14
(cd packages-internal/credential-provider-node && yarn test)       # baseline 23/23
```

## Reproductions

```sh
cd /d/ToptalAssessment/aws-sdk-js-v3/assessment/phase1
export NODE_PATH='D:/ToptalAssessment/aws-sdk-js-v3/node_modules'   # resolve to the workspace build
node gist/repro-duplicate.cjs                # reporter's gist, unmodified
node gist/repro-hang.cjs [hang|fail|timeout-warn|timeout-throw]
node repro/repro-8358-duplicates.cjs         # STS requests by remaining lifetime x call pattern
node repro/repro-8359-stall.cjs              # stall, recovery-doesn't-unblock, 4-min variant (~13 s)
node repro/repro-expired-fallback.cjs        # fallback signs with expired creds (~4 s)
```

Add `2>/dev/null` to drop the SDK's Node-20 deprecation notice from the output. Each script prints the resolved package paths first, so every result can be traced to the build it ran against.

## Layout

- `gist/`: the reporter's reproduction gist (b1375fba…), verbatim, including the reporter's own recorded outputs.
- `repro/`: my scripts. `lib/fake-sts.cjs` numbers each issued credential (`ASIAFAKE0001`, and so on), so a token can be traced to the credentials that signed it.
- `results/`: outputs at the pinned SHA.
- `tooling/`: the Windows build shim.
