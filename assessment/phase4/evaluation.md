# Phase 4: evaluation of both outputs

This applies [../rubric.md](../rubric.md), which was frozen at tag `assessment-frozen` before the runs. The outputs are on the local branches `eval/opus-5-5` and `eval/sonnet-5-5`: the pinned code plus each model's diff, verbatim. Raw results are in `../results/<label>/`, and probe results in `probe-results/`.

## 1. Does it apply, build and pass the existing tests?

| | Opus 5.5 | Sonnet 5.5 |
|---|---|---|
| `git apply` onto the pin | clean | clean |
| Build (types, ES, CJS) of `rds-signer` and `credential-provider-node` | ok | ok |
| `rds-signer` tests (existing plus the model's own) | 20/20 (14 + 6 new) | 16/16 (14 + 2 new) |
| `credential-provider-node` tests | 23/23 (untouched) | 23/23 (untouched) |
| oxlint | clean | clean |
| oxfmt | not assessable: the pinned code fails `--check` on this CRLF checkout too | same |
| Files touched | `Signer.ts`, `Signer.spec.ts` | `Signer.ts`, `Signer.spec.ts` |

## 2. Correctness: rubric rows side by side

Each cell gives the fake-timer harness result (tests passed) and, where it exists, the real-time layer result (`RT`).

| Row | Baseline (pin) | Opus 5.5 | Sonnet 5.5 | Reference |
|---|---|---|---|---|
| R1 Bounded wait | FAIL 0/2 · RT fail | **PASS** 2/2 · RT pass | **PASS** 2/2 · RT pass | PASS 2/2 · RT pass |
| R2 Bounded wait in the passive window | FAIL 0/1 · RT fail | **PASS** 1/1 · RT pass | **PASS** 1/1 · RT pass | PASS 1/1 · RT pass |
| R3 Healthy refresh still wins | PASS 3/3 · RT pass | PASS 3/3 · RT pass | PASS 3/3 · RT pass | PASS 3/3 · RT pass |
| R4 Expiry checked again at fallback | FAIL 1/3 · RT fail | **FAIL 0/3** · RT fail | **FAIL 0/3** · RT fail | PASS 3/3 · RT pass |
| R5 Already-expired credentials | FAIL 2/3 | **FAIL 2/3** | **FAIL 1/3** | PASS 3/3 |
| R6 No unhandled rejection | PASS 3/3 | PASS 3/3 | PASS 3/3 | PASS 3/3 |
| R7 Timer cleanup | PASS 2/2 | PASS 2/2 | PASS 2/2 | PASS 2/2 |
| R8 No stuck lock or stale cache | FAIL 0/3 | **PASS** 3/3 | **PASS** 3/3 | PASS 3/3 |
| R9 Concurrency | FAIL 1/3 · RT fail | **PASS** 3/3 · RT pass | **PASS** 3/3 · RT pass | PASS 3/3 · RT pass |
| R10 #8358 *(thoroughness)* | FAIL 2/5 | **FAIL 2/5** (not attempted) | **FAIL 2/5** (not attempted) | PASS 5/5 |
| R11 No regressions | PASS 4/4 | PASS 4/4 | PASS 4/4 | PASS 4/4 |

**Both outputs fix the reported bug.**

- **The bug is gone.** The stall no longer blocks `getAuthToken()` (R1, R2, R9), in simulated and in real time.
- **Nothing regressed.** The healthy early refresh is preserved (R3), there are no leaked timers or unhandled rejections (R6, R7), and both recover after a timed-out refresh settles later (R8).
- **Both fail the same rows.** R4 (tokens from credentials that expire during the wait), R5 (already-expired credentials) and R10 (#8358, which neither attempted).

### Informational rows

| Row | Opus 5.5 | Sonnet 5.5 | Reference |
|---|---|---|---|
| I1 Fallback latency (the chosen deadline) | 5,000 ms, private constant | 5,000 ms, private constant | 5,000 ms |
| I2 5 sequential calls during a stall | 5,000 ms each | 5,000 ms each | 5,000, then 0, 0, 0, 0 |
| I3 New call after STS recovers | joins the stalled refresh (cached token) | same | same |
| I4 Forced refreshes for 10 concurrent calls (non-memoized provider) | 1 | 10 | 1 |
| I5 Anything logged on fallback | nothing | nothing | nothing |
| I6 Pending timers after a healthy refresh | 0 | 0 | 0 |
| I7, I7b Memoizer double refresh (#8358) | unchanged (2) | unchanged (2) | 1 |
| I8 Refreshed set still under 15 min | original set | original set | original set |
| I9 Names the token-lifetime trade-off / #8358 | yes / no | yes / no | — |

### Probes (cases from manual review that the harness doesn't measure directly)

| Probe | Opus 5.5 | Sonnet 5.5 | Baseline | Reference |
|---|---|---|---|---|
| P1: refresh #1 stalls forever; the cached credentials then expire; STS has recovered. Does the next call recover? | **no: pending for good** (1 forced call) | yes, fresh token after 500 ms | yes | yes |
| P2: stuck forced refreshes left after 5 sequential / 10 concurrent calls during a stall | 1 / 1 | **5 / 10** | 5 / 10 (calls hang) | 1 / 1 |
| P3: validity left in the token's credentials at return, with 4.9 s / 5.0 s / 6 s left and the refresh stalling | **0 / 0** / 1000 ms | **−100 / 0** / 1000 ms | pending | rejects / rejects / 1000 ms |

## 3. Issues, by severity

Each issue gives the location and a concrete scenario ("input → wrong result"). Severities follow the rubric's definitions. Line numbers refer to the files on the `eval/*` branches.

### Opus 5.5

| ID | Severity | Location | Input → wrong result | Evidence |
|---|---|---|---|---|
| O1 | **Major** | `Signer.ts:164`, `:179` | The wait is capped at `Math.min(5000, remainingMs)`, and line 179 returns the cached credentials without checking them again. A timer fires at or after its delay, so when 5 s or less is left the fallback happens at the instant of expiry. **Input:** cached credentials with 2 s left, refresh stalls or fails slowly. **Result:** `getAuthToken()` resolves at 2,000 ms with a token whose credentials expire at that same millisecond. In real time, with 3 s left, the token arrives at 3,002 ms, signed by credentials that expired 2 ms earlier. No error. At the pin the stall case hung; it now returns a dead token. The test at `Signer.spec.ts:262` asserts this as correct behaviour, and the final message claims "That still gives a valid token". | R4 0/3, RT R4 fail, P3 |
| O2 | **Major** | `Signer.ts:138`, `:171–179` | The refresh error is swallowed (`.catch(() => undefined)`). In the already-expired branch, a *failed* refresh then lands on line 179 and returns the expired credentials. **Input:** a provider returns credentials that expired 1 min ago, and the forced refresh rejects. **Result:** a token signed with the expired credentials, and the refresh error is lost. The caller sees a database authentication failure instead of the credential error. This is inherited from the pin, but the new branch's own comment says "only a refresh can produce usable ones". | R5 fail case |
| O3 | Minor | `Signer.ts:133–147`, `:173` | `pendingRefresh` is cleared only when the refresh settles. A refresh that never settles pins it forever. Once the cached credentials expire, line 173 awaits that stuck promise instead of starting a new attempt. **Input:** a non-memoized provider, the forced refresh stalls forever, the credentials then expire, and STS recovers. **Result:** every later `getAuthToken()` hangs indefinitely; the pin and Sonnet both recover here. Rated Minor rather than Major for two reasons. The rubric accepts unbounded waiting when nothing valid remains. And the default chain never reaches this branch, because its memoizer drops expired credentials and fetches new ones. | P1 |
| O4 | Minor | `Signer.ts:162–165` | The refresh is shared, but each call starts its own 5 s timer. **Input:** STS stalls, and a pool opens 5 connections one after another. **Result:** each waits 5 s (25 s in total), even though the shared refresh already timed out for the first caller. | I2 |
| O5 | Minor | `Signer.ts:138` | The fallback is silent. Errors are swallowed, and nothing is logged when the deadline fires. An STS outage leaves no trace while tokens quietly become short-lived. | I5 |
| O6 | Nit | `Signer.spec.ts:242–320` | Five of the six new tests reach the wrapper through `//@ts-ignore SignatureV4.mock.calls[0][0].credentials`. This follows the existing tests' pattern; the first new test shows the public path through `getAuthToken()` works. | — |

### Sonnet 5.5

| ID | Severity | Location | Input → wrong result | Evidence |
|---|---|---|---|---|
| S1 | **Major** | `Signer.ts:141` (with `:124–139`) | The fallback returns the credentials captured at line 123, with no check of their expiry. **Input:** cached credentials with 4.9 s left, refresh stalls. **Result:** the token is returned at 5,000 ms, signed by credentials that expired 100 ms earlier. In real time, with 3 s left and STS failing after 4 s, the token arrives at 4,020 ms, signed by credentials about 1 s expired. No error. At the pin the stall case hung; it now returns a dead token. | R4 0/3, RT R4 fail, P3 |
| S2 | **Major** | `Signer.ts:124`, `:141` | Already-expired credentials satisfy the `< 15 min` condition, so they go through the same 5 s race and fallback. **Input:** credentials that expired 1 min ago, and the refresh stalls. **Result:** after 5 s, a token signed with the expired credentials. This path is new; the pin hung here. If the refresh fails instead, the same thing happens immediately (inherited). The comment on lines 127–128 ("fall back to the still-cached credentials") assumes a validity the code never checks. | R5 1/3 |
| S3 | Minor | `Signer.ts:132` | Nothing is shared: every call starts a new forced refresh. **Input:** a non-memoized provider during a stall. **Result:** a pile of stuck refreshes, each holding a pending promise and possibly a socket: 5 after 5 sequential calls, 10 after 10 concurrent ones. The default chain coalesces these in its memoizer, so only custom providers are affected. | P2, I4 |
| S4 | Minor | `Signer.ts:129–132` | A 5 s wait per call during an outage, as in O4. | I2 |
| S5 | Minor | `Signer.ts:136` | `catch {}` swallows both the timeout and every refresh error, and nothing is logged, as in O5. | I5 |
| S6 | Minor | `Signer.spec.ts:199`, `:225` | The tests are thin. There are 2, both reaching the wrapper through `//@ts-ignore` on the `SignatureV4` mock. The stall test never asserts that the call is still pending before 5 s, so a version that falls back without waiting but still fires the refresh would also pass it. There are no tests for expiry, concurrency, or a late rejection. Only `Signer.spec.ts` was run (no full suite, type check or lint), and the final message says so. | — |

### Thoroughness (R10, scored outside the defect count)

Neither model read the credential chain the prompt pointed to ("default provider chain"), so neither found the passive/forced double refresh (#8358). It still causes 2 STS requests per call in the last 5 minutes, and 2 failed requests per call during an outage. Opus read `runtimeConfig.ts` and the `git log` of `Signer.ts`, but stopped at the signer. Sonnet read only `Signer.ts` and its spec.

### Severity summary

| | Critical | Major | Minor | Nit |
|---|---|---|---|---|
| Opus 5.5 | 0 | 2 (O1, O2) | 3 (O3, O4, O5) | 1 (O6) |
| Sonnet 5.5 | 0 | 2 (S1, S2) | 4 (S3, S4, S5, S6) | 0 |

## 4. Shortcuts and claims versus code

**Opus 5.5**

- *False:* "If the timer wins, the token is signed with the cached credentials. That still gives a valid token." This is not true when 5 s or less is left (O1). Worse, the test "should not wait longer than the remaining validity" (`Signer.spec.ts:262`) asserts the fallback at the exact moment of expiry as the intended behaviour. The defect therefore looks deliberate and tested to a reviewer.
- *Incomplete:* "Already-expired credentials still wait." True for a stall, but it leaves out that a failed refresh then signs with the expired credentials (O2).
- *Verified true:*
  - all 20 package tests pass; type check and oxlint are clean;
  - the 3 stall tests hang against the original code (seen in the transcript, call 9);
  - the timer is cleared;
  - no unhandled rejection;
  - in-flight refreshes are reused (I4 = 1).

**Sonnet 5.5**

- *Over-claim in a code comment:* "fall back to the still-cached credentials" (`Signer.ts:127–128`). The fallback never checks validity, and it also applies to expired credentials (S1, S2). The final message says the token is signed with "near-expiry" credentials; it can also be signed with expired ones.
- *Verified true:*
  - 13 tests in `Signer.spec.ts` pass (16 package-wide);
  - timer cleanup works, with no unhandled rejection;
  - "didn't run lint or the type check" is honest, and both are in fact clean.
- *Weak test:* the stall test checks only the end state, not that any waiting happened (S6).

**Both:** no `@ts-ignore` in the production code, no skipped tests, and nothing claimed for #8358.

## 5. How each model read the prompt (feeds into prompt-notes.md and write-up Section 5)

- **"Can no longer block".** Both read it as *bound the wait*, not *never wait*, so both kept the healthy refresh (R3). Both picked 5 s as a private constant. Opus offered to turn it into a `SignerConfig` option; Sonnet offered to change the value.
- **Where to fix it.** Both stayed in the signer. Neither followed "default provider chain" into the memoizer, so #8358 went unnoticed (R10).
- **"Still valid".** Both took it as the premise that justifies falling back, but neither turned it into a check at fallback time (R4).
  - Opus came closest: it capped the wait at the remaining validity. The intent was right; the boundary was wrong (O1).
  - Sonnet never treated validity as something the code has to check.
- **Already-expired credentials.** Opus reasoned about them explicitly (wait, because only a refresh helps) but left the failure path signing with them. Sonnet didn't distinguish them at all (S2).
- **Trade-off.** Both said the fallback token may last less than 15 minutes (I9). Neither connected it to #8047, and neither surfaces the fallback through a log.

## 6. Draft verdict (for Phase 5)

**Opus 5.5 is slightly better.**

Under the frozen verdict scale, the outputs have the same Critical/Major profile: 0 Critical and 2 Major each. In both, the fallback can sign with credentials that are expired or that expire at the moment of return, and both sign with already-expired credentials when a refresh fails. They also fail the same scored rows: R4, R5 and R10.

Opus's advantages:

- On R5, it waits instead of signing with expired credentials when the refresh stalls.
- It coalesces stalled refreshes (P2/I4).
- Its tests are much stronger, and they were verified against the original code.
- It ran the type check and lint.

These are partly offset by two things:

- a confidently wrong validity claim, backed by a test that writes O1 in as intended behaviour;
- a stuck shared refresh after expiry (O3), which Sonnet doesn't have.
