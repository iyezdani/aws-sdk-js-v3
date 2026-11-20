# Run protocol (Phase 3) and application protocol (Phase 4)

This protocol is fixed before the runs, so that both models are run, and their outputs applied, the same way.

## Prepare one clean clone per model (before each run)

```sh
# Clone from the fork, main only: the assessment branches are local and unpushed, so they don't exist there.
git clone --single-branch --branch main https://github.com/iyezdani/aws-sdk-js-v3.git /d/ToptalAssessment/runs/model-a
cd /d/ToptalAssessment/runs/model-a
git rev-parse HEAD                        # must be b90fc58acae6212a5eefcc92ddfbaf1117ba08e9
yarn install
export NODE_OPTIONS="--require D:/ToptalAssessment/aws-sdk-js-v3/assessment/phase1/tooling/win-spawn-shim.cjs"
yarn workspaces foreach --from @aws-sdk/rds-signer -R -t -p -j 4 run build
unset NODE_OPTIONS
(cd packages/rds-signer && yarn test)     # must pass 14/14 before the model starts
git status --short                        # must be empty
```

Repeat for `model-b`. After preparing both clones, **switch the evaluation clone to `main`** (`git -C /d/ToptalAssessment/aws-sdk-js-v3 checkout main`), so that `assessment/` is not on disk while the models run.

Why separate clones at other paths:

- Claude Code keys project memory by path, so a new path guarantees the run starts with none.
- Neither model sees the other's changes.
- A `--single-branch` clone of the fork carries no assessment history.

## Run each model

- Fresh session, started in the model's own clone. No custom instructions, `CLAUDE.md`, `AGENTS.md` or memory.
- Paste the frozen [prompt](prompt.md) exactly once. No follow-ups, no retries, and no answers to the model's questions. If it asks something, record that, and record what it did next.
- Record the model name and version, the effort or reasoning setting, the tool and its version, the date, and the permission mode. Note that `~/.claude/settings.json` sets Opus 5.5 to `xhigh` by default.
- Save the full transcript export verbatim. Then save the output, with new files included and build output and `node_modules` left out by `.gitignore`: run `git status --short > ../model-a.status`, then `git add -A && git diff --cached --binary > ../model-a.diff`.
- Check the transcript for reads outside its clone, especially of `D:\ToptalAssessment\aws-sdk-js-v3\assessment`.

## Apply each output for evaluation (Phase 4)

```sh
cd /d/ToptalAssessment/aws-sdk-js-v3
git checkout -b eval/model-a assessment                 # pin + assessment/
git apply --index ../runs/model-a.diff                  # record whether it applies cleanly
git commit -m "model-a output, verbatim"
bash assessment/harness/run.sh model-a
```

Whether the diff applies, builds and type-checks is itself a finding. Record it before fixing anything. Never edit a model's output to make it run. If it cannot run, that is the result.
