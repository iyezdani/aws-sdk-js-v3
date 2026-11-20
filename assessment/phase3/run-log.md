# Phase 3 run log

These are the conditions shared by both runs. The per-run details, including the exact command, times and exit code, are in `<label>.run.txt`.

| | |
|---|---|
| Date | 2026-11-19 (US) / 2026-11-20 UTC |
| Machine | Windows 11 Home 10.0.26300, Node 20.20.0, Yarn 4.17.1 |
| Interface | Claude Code CLI 2.1.329 (`claude.exe` bundled with the VS Code extension), headless `-p` (print mode): one prompt, no follow-ups possible |
| Models | `claude-opus-5-5` (label `opus-5-5`, clone `D:\src\a\aws-sdk-js-v3`); `claude-sonnet-5-5` (label `sonnet-5-5`, clone `D:\src\b\aws-sdk-js-v3`) |
| Effort | `--effort medium` for both. This overrides the user-level default of `xhigh` for Opus, which is not loaded anyway. |
| Permission mode | `--permission-mode auto` for both (classifier-gated) |
| Prompt | Frozen at tag `assessment-frozen`, sent on stdin. `prompt.txt` has SHA-256 `7fc3ee693ad9d8da79a39c626f686424a50846f117671c489a24403746dd46bc` and 94 words |
| Starting state | Each clone is a `--single-branch` clone of the fork's `main`, at `b90fc58` (clean). `yarn install` and the rds-signer closure (17 packages) were built beforehand with the same shim, and `rds-signer` tests passed 14/14 in both before the run |
| Scheduling | Both runs are started together and run in parallel on the same machine |

## Environment decisions (same for both runs)

- **No user settings, instructions or memory.** `--setting-sources project,local`; the repo has no project settings. There is no `CLAUDE.md` or `AGENTS.md` at user or repo level. Each clone is at a new path, so no project memory exists for it.
- **No MCP servers.** `--strict-mcp-config` with an empty config. The smoke test showed that otherwise my account's claude.ai connectors load *nondeterministically*: they appeared in one session and not in another. That was a fairness problem, and a privacy one.
- **`WebSearch` disabled.** `--disallowedTools WebSearch`. Issue #8359 is public, and its text gives the expiry re-check and #8358, which the prompt deliberately omits (see prompt-notes.md). `gh` and network access through Bash are still available to both, so the transcripts are checked for them.
- **Identical tool surface, confirmed from the session init events:** 29 tools, no MCP servers, the same 4 built-in plugins and 23 skills.
- **Deviation from run-protocol.md: neutral clone paths.** I used `D:\src\{a,b}\aws-sdk-js-v3` instead of `D:\ToptalAssessment\runs\model-{a,b}`. A session sees its working directory, and a path naming an assessment and a "model" invites behaving as if under test.
- **Ground truth hidden during the runs.** The evaluation clone is switched to `main` for the duration, so `assessment/` is not on disk. Artifacts are written to `C:\Users\imady\ToptalArtifacts\phase3`, outside both clones.

## Smoke tests before the runs (not attempts at the task)

A one-word prompt ("Reply with the single word OK.") was run in an empty scratch directory. It checked the model IDs, the effort flag, `auto` mode and the init environment, then the complete run script on a toy repository. No task prompt was sent before the real runs.

## Runs

Both runs were started at 2026-11-20T01:01:39Z. Raw records are in `runs/<label>.*`:

- `run.txt`: the command, versions and times;
- `transcript.jsonl`: the full stream-json transcript;
- `final-message.md`: the model's final message, verbatim;
- `diff`: `git diff --cached --binary` after `git add -A`;
- `status.txt` and `diffstat.txt`.

| | Opus 5.5 (`opus-5-5`) | Sonnet 5.5 (`sonnet-5-5`) |
|---|---|---|
| Exit / result | 0 / `success` | 0 / `success` |
| Wall time | 3 min 3 s (01:01:39–01:04:42) | 37 s (01:01:39–01:02:16) |
| Turns | 16 | 8 |
| Tool calls | 15 | 7 |
| Output tokens | 9,966 | 2,764 |
| Reported cost | $0.547 | $0.113 |
| Files changed | `Signer.ts` (+57/−6 lines), `Signer.spec.ts` (+146/−1) | `Signer.ts` (+15/−2), `Signer.spec.ts` (+53/−0) |
| Permission denials | none | none |
| Questions to the user | none | none |
| stderr | empty | empty |

## Compliance check of the transcripts

The check covered every tool call: paths outside the clone, network use, and any mention of the assessment.

- **Sonnet 5.5.** All 7 calls stayed inside its clone. It read `Signer.ts` and `Signer.spec.ts`, edited both, and ran `npx vitest run src/Signer.spec.ts` once. No network use.
- **Opus 5.5.** All 15 calls stayed inside its clone, with two notes:
  1. **Call 9.** It temporarily copied `Signer.ts` to `D:\src\a\signer.bak` (outside the repo). It restored the original code to confirm that its new tests fail without the fix (result: 3 failed, 14 passed), then restored its version and deleted the backup. Nothing was left behind, and nothing outside the clone was read.
  2. **Calls 9–13.** It tried format and lint checks. `npx prettier --check` downloaded `prettier@3.10.1` from the npm registry (network use, but only for tooling, not for task information). It then found and used the repo's own `oxfmt`/`oxlint`. In call 14, `git stash` / `git stash pop` restored the tree; no stash was left.
- **Neither run** touched or read anything under `D:\ToptalAssessment`, `gh`, or any issue tracker.
- **Personal data in the transcripts:** none beyond local paths containing the Windows username, and session or message UUIDs.
