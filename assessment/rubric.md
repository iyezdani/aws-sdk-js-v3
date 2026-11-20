# Evaluation rubric (frozen before the model runs)

**Task:** aws-sdk-js-v3 [#8359](https://github.com/aws/aws-sdk-js-v3/issues/8359). `@aws-sdk/rds-signer` blocks on a stalled early credential refresh. [#8358](https://github.com/aws/aws-sdk-js-v3/issues/8358) (duplicate STS refreshes) sits on the same code path but is **not mentioned in the prompt**.

**Baseline:** `b90fc58acae6212a5eefcc92ddfbaf1117ba08e9`. The ground truth and the measured reproductions are in [phase1/design-notes.md](phase1/design-notes.md).

The rubric is applied identically to both outputs. Every scored row is implemented by a test in [harness/](harness/). The test title starts with the row ID, and `harness/run.sh` turns the results into a row table.

## Scoring policy

1. **Black-box first.** The harness drives the real `Signer` (real SigV4 signing) and the real `memoizeChain`. It reads *which credentials signed a token* from the token's `X-Amz-Credential`. It assumes no option names, no specific deadline, no error text and no internal helpers. A design is never marked down for differing from the reference fix. See "Reasonable but different" below.
2. **Simulated time.** Rows R1–R9 run under Vitest fake timers, with `Date` faked as well. Some timer mechanisms are not driven by fake timers, for example `AbortSignal.timeout()`, `node:timers/promises`, or timers captured before the test installs fakes. If an output uses one of these and a timing row fails, I re-check that row with layer 3 (`harness/realtime-check.cjs`: real time, built `dist`, 30 s windows) before scoring it. The row is scored on the real-time result, and the mechanism is noted. The Phase 1 reproduction scripts are not used for scoring: their 3 s observation windows are shorter than reasonable deadlines.
3. **Fail, N/A and "beyond the prompt".**
   - A row fails only on observed wrong behaviour.
   - R10 measures #8358, which the prompt does not mention. It is scored as **thoroughness** (did the model notice it?), not correctness. However, any *regression* a model introduces in the memoizer counts as a correctness issue (R10e, R11).
4. **Three test layers per output, all run by `harness/run.sh <label>`, which rebuilds the changed packages first:**
   1. The package's existing tests, plus the model's own new tests.
   2. This harness (fake timers, against source).
   3. Real-time checks of R1, R2, R3, R4 and R9 against the rebuilt `dist` (`harness/realtime-check.cjs`).

   Layers 1 and 3 are recorded alongside the harness row table.
5. **Validation of the harness itself.** At the pin (`results/baseline/`), every row fails or passes as the "At the pin" column predicts. A reference fix (local branch `assessment-reference`, never shown to the models) passes every scored row in all three layers (`results/reference/`).
6. **Manual review is separate from the tests.** Every issue is logged as *file:line, "input X → wrong result Y", severity*. Vague wording such as "seems fragile" is not used.

## Scored rows

| Row | What must hold | Harness test(s) | At the pin |
|---|---|---|---|
| **R1** Bounded wait | Cached credentials have 10 min left and the forced refresh stalls: `getAuthToken()` resolves with a token signed by the cached credentials within **30 s** (simulated). Applies to a plain provider and to the memoized chain. | `R1 [plain]`, `R1 [chain]` | FAIL (hangs) |
| **R2** Bounded wait in the passive window | 4 min left, memoized chain. The passive and the forced refresh both stall. Same expectation as R1. | `R2 [chain]` | FAIL |
| **R3** Healthy refresh still wins | A refresh that completes after **500 ms** is used, so the token is signed with the refreshed credentials. Checked at 10 min (plain, chain) and 4 min (chain). Guards against reintroducing #8047. | `R3 …` (3 tests) | PASS |
| **R4** Expiry checked again at fallback | The cached credentials expire *during* the wait. No token may be signed with credentials that are expired when it is returned. Staying pending or rejecting are both acceptable. Cases: slow failure with a plain provider, slow failure with the chain, and a stall. | `R4 …` (3 tests) | FAIL (2 of 3) |
| **R5** Already-expired credentials | The provider returns already-expired credentials, and the forced refresh fails or stalls. Those credentials never sign a token. If the refresh succeeds, its credentials are used. | `R5 …` (3 tests) | FAIL (1 of 3) |
| **R6** No unhandled rejection | The refresh is abandoned after the fallback and later rejects. No `unhandledRejection` is raised. Checked for plain at 10 min, chain at 10 min and chain at 4 min. | `R6 …` (3 tests) | PASS (vacuous: never falls back) |
| **R7** Timer cleanup | After a healthy refresh wins, no *ref'd* timer created by the signer is left alive: no `Timeout` resources beyond the baseline (real timers). | `R7 …` (2 tests) | PASS (no timers) |
| **R8** No stuck lock or stale cache | A refresh that timed out later **rejects**: the next call, with STS healthy, is signed with fresh credentials. A refresh that timed out later **succeeds** (chain): the next call uses those credentials without another refresh. | `R8 …` (3 tests) | FAIL (hangs first) |
| **R9** Concurrency | 10 concurrent calls during a stall all resolve within 30 s with the cached credentials (plain, chain). 10 concurrent calls with a healthy refresh trigger exactly **1** refresh, and all are signed with the fresh credentials (chain). | `R9 …` (3 tests) | FAIL (2 of 3) |
| **R10** #8358 duplicates *(thoroughness)* | End to end through the real default chain and a fake STS, with 4 min left. Healthy STS: 1 STS request for 1 call and for 10 concurrent calls (today 2). STS failing: 1 request per call over 5 sequential calls, and every token is still issued from the cached credentials (today 2 per call). Guard: with 10 min left there is still exactly 1 early refresh, and it is used. **R10e:** a forced caller still sees the refresh's error when STS fails. | `R10a`–`R10e` | FAIL (a, b, c) |
| **R11** No regressions | A static credential object is used as-is. No forced refresh when there is no expiration or more than 15 min left (plain, chain). **Plus** both existing suites pass: `packages/rds-signer` (14) and `packages-internal/credential-provider-node` (23). Changes to existing tests are judged on whether they are justified. | `R11 …` (4 tests) + `run.sh` | PASS |

## Informational rows (recorded, not scored; used in the write-up)

| Row | What is recorded |
|---|---|
| I1 | The observed fallback latency in R1, i.e. the effective deadline the model chose, and whether it is configurable. |
| I2 | Outage cost: latency of 5 *sequential* calls during a stall. Does every call pay the full deadline? |
| I3 | Does a call made after STS recovers get fresh credentials, or does it join the stalled refresh? |
| I4 | Whether the signer coalesces forced refreshes for a non-memoized provider across 10 concurrent calls (today: 10 forced calls). |
| I5 | Whether a warning or log is emitted on fallback. |
| I6 | Fake-timer count after a healthy refresh, including unref'd timers. |
| I7 | Memoizer: a plain call within 5 min while a forced refresh is in flight. Does it start a second refresh? |
| I8 | The refresh returns credentials that still expire within 15 min. Which set is used? Today it is the original, even if the refreshed set lives longer. |
| I9 | Does the explanation name the token-lifetime trade-off (a fallback token only lives until the cached credentials expire, #8047)? Does it mention #8358? |

## Severity definitions

- **Critical.** A realistic input makes the fix fail at its purpose or makes things worse:
  - `getAuthToken()` can still hang unboundedly while valid credentials exist (R1/R2/R9 under real time);
  - the process can crash through an unhandled rejection (R6);
  - a healthy early refresh no longer yields refreshed credentials, reintroducing #8047 (R3);
  - or the change does not compile, or breaks the existing suites for reasons other than intended behaviour changes.
- **Major.** A wrong result on a realistic edge case, or a production-visible defect:
  - a token signed with expired credentials is introduced, or left in the fallback path (R4/R5);
  - a stuck lock or cache poisoning (R8);
  - one ref'd timer leaked per call (R7);
  - a memoizer change that swallows refresh errors (R10e) or breaks existing memoizer behaviour;
  - an existing behaviour or test changed without justification;
  - an explanation that claims a behaviour the code does not have.
- **Minor.** Safe but suboptimal:
  - every call pays the full deadline during an outage (I2);
  - an unexplained magic deadline;
  - no signal on fallback (I5);
  - tests that only mock *rejections* and never a *stall*, or that rely on long real-time waits;
  - an unref'd but uncleared timer.
- **Nit.** Naming, comments, docs, style, changelog or formatting.

## Reasonable but different (accepted, not marked down)

- **Where the bound lives.** In the signer (expected), or as a provider-level timeout, as long as the signer's default path ends up bounded. Changing defaults for *every* SDK client, such as turning on socket timeouts globally, is out of scope. That is judged as risk, not as a fix.
- **Deadline.** A constant or configurable, with any value at which a 500 ms refresh wins and the fallback happens within 30 s. Capping the deadline by the remaining lifetime is fine.
- **Cached credentials expired at the deadline.** Keep awaiting, or reject with a clear error. Both are fine. Returning expired credentials is not.
- **Concurrency.** A per-call deadline or a shared deadline per in-flight refresh. Both are fine; I2 records the cost.
- **#8358 fix location.** Joining the in-flight refresh in the memoizer (the root-cause fix), or avoiding the double call in the signer. Both pass R10 if the counts drop and errors still reach the caller.
- **Refreshed credentials still under 15 min.** Returning the original (today's behaviour) or the longer-lived set (I8). Both are fine. Changing it must keep or knowingly update the existing test.
- **Cancellation.** Passing an `AbortSignal` into the provider is a fine extra but not required, since providers don't honour it.
- **Timer mechanism.** `setTimeout`/`clearTimeout`, `unref`, or `AbortSignal.timeout` are all accepted if R7 holds. See scoring policy 2 for fake-timer compatibility.

## Looks done but isn't (checked by hand for each output)

- `Promise.race` against a timer that is never cleared (R7), or a timeout that is set up and then awaited past anyway.
- The abandoned refresh is left without a rejection handler (R6).
- The fallback returns the credentials captured *before* the wait (R4).
- A signer-level lock or cache that keeps a rejected or stalled promise forever, or latches into "always fall back" (R8).
- The memoizer joins the passive refresh but loses its error (R10e).
- The early refresh is effectively disabled: a tiny deadline, or the refresh removed altogether (R3).
- Tests that mock only a rejection, or `@ts-ignore`/`as any` used to reach privates where a public path exists.
- Claims in the explanation that the code or tests don't support, for example "fixes the duplicate refresh" when R10 still fails.

## Verdict scale

- **Decisively:** one output fixes #8359 with no Critical issue, and the other does not; or the gap is two or more Major issues.
- **Clearly:** both fix the core hang, but one has at least one more Major issue, or fails at least two more scored rows.
- **Slightly:** the same Critical/Major profile, with the difference lying in Minor/Nit issues, test quality, or thoroughness (R10, I-rows).
