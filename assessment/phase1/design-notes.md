# Phase 1: ground truth for aws-sdk-js-v3 #8359 (with #8358)

## Baseline

| | |
|---|---|
| Repository | https://github.com/aws/aws-sdk-js-v3 |
| Pinned SHA | `b90fc58acae6212a5eefcc92ddfbaf1117ba08e9` ("Publish v3.1173.0", 2026-11-19) |
| Issues | [#8359](https://github.com/aws/aws-sdk-js-v3/issues/8359) stalled refresh, [#8358](https://github.com/aws/aws-sdk-js-v3/issues/8358) duplicate refresh. Both open, labelled `bug`, `p3` |
| Origin of regression | [#8054](https://github.com/aws/aws-sdk-js-v3/pull/8054) (3.1058.0), which added early refresh to fix [#8047](https://github.com/aws/aws-sdk-js-v3/issues/8047) |
| Related | [#8280](https://github.com/aws/aws-sdk-js-v3/issues/8280)/#8281 (passive-refresh unhandled rejection, fixed); [#8363](https://github.com/aws/aws-sdk-js-v3/pull/8363) (SSO in-flight refresh sharing, merged 2026-10-16) |
| Drift check | No commits touch `packages/rds-signer/src`, `packages-internal/credential-provider-node/src`, `packages/credential-provider-web-identity/src` or `fromNodeProviderChain.ts` between the reporter's 3.1152.0 and the pin |

## Code paths at the pin

**Signer wrapper** ([Signer.ts:118-131](../../packages/rds-signer/src/Signer.ts#L118-L131)). This wraps every *function* credential provider. Static credential objects are not wrapped. The default provider is `fromNodeProviderChain({ profile })` ([runtimeConfig.ts](../../packages/rds-signer/src/runtimeConfig.ts)). `getAuthToken()` builds a new `SignatureV4` each time, and `presign` calls the provider once with no arguments. The wrapper works like this:

1. `credentials = await provider(props)`, a plain call.
2. If `expiration - now < 15 min`, it awaits `provider({ ...props, forceRefresh: true })` **with no bound**.
3. If the refreshed credentials have ≥ 15 min, or no expiration, it returns them. Otherwise, or on any error (an empty `catch {}`), it returns the `credentials` object it **captured in step 1**. It does not check that object's expiry again.

**Memoizer** ([memoize-chain.ts:35-84](../../packages-internal/credential-provider-node/src/runtime/memoize-chain.ts#L35-L84)):

- *Forced path* (L36-48). Concurrent forced calls are coalesced on `forceRefreshLock`. This path ignores `passiveLock` and `activeLock`, waits without a bound, and overwrites the cache on success. A rejection goes to every joined caller. The lock is cleared in `finally`, so a promise that never settles holds the lock forever.
- *Plain path*. It drops expired credentials and joins `activeLock` if one exists. With no credentials it runs a blocking fetch (`activeLock`). With credentials that have < 5 min left (`credentialsTreatedAsExpired`), it starts a background refresh (`passiveLock`, errors swallowed since #8281) and returns the cached credentials immediately.
- Among the providers, only `memoizeChain` honours `forceRefresh`. Other providers, including custom functions, ignore it, so for them the wrapper's step 2 is simply a second call. The memoizer also forwards `forceRefresh` into each provider in the chain (`runtimeOptions: ["forceRefresh"]` in the spec).

**Why #8358 happens.** With < 5 min left, the signer's plain call starts the memoizer's passive refresh. Its forced call then starts an independent chain call, because the forced path never looks at `passiveLock`. The result is 2 STS requests per near-expiry window, and 2 failed requests per call during an outage. Between 5 and 15 min there is no duplicate: only the forced refresh runs.

**Why #8359 happens.** With 5–15 min left, the forced refresh is awaited with no deadline. At the pin, the nested STS client has no request timeout and no socket timeout by default:

- `DEFAULT_REQUEST_TIMEOUT = 0`, and `requestTimeout` only logs a warning unless `throwOnRequestTimeout: true` is set.
- #8396 (2026-11-04) added a 300 s per-service `defaultSocketTimeout` for STS ([sts/runtimeConfig.ts:61](../../packages-internal/nested-clients/src/submodules/sts/runtimeConfig.ts#L61)). It is **opt-in** via `AWS_ENABLE_DEFAULT_SOCKET_TIMEOUT_2026=true` ([getDefaultSocketTimeout.ts](../../packages-internal/core/src/submodules/client/getDefaultSocketTimeout.ts)). Even when enabled, it allows a 5-minute stall per attempt, against a 5–15-minute validity window, so it does not fix #8359. I found this by reading the code; I did not measure it.

The forced lock is shared, so every later `getAuthToken()` joins the same stalled promise. That includes calls made after STS has recovered. Nothing unblocks them until the stalled socket errors. This is measured below; it is not in the issue.

**The #8363 SSO fix, for comparison.** It keeps an in-flight refresh map per `sso_session` that concurrent callers await. When the refresh fails, it falls back to the existing token **only after `validateTokenExpiry(existingToken)`**, so it does check expiry again before falling back. It does not bound the wait. It is a precedent for *sharing* the in-flight work, and for *checking expiry again on fallback*.

## Reproduction at the pin (measured 2026-11-19, Windows 11, Node 20.20.0, local workspace build)

All runs use the real `fromNodeProviderChain()` web-identity path against a loopback fake STS, with `AWS_MAX_ATTEMPTS=1`. The resolved package paths are in `results/resolution.txt`. Raw output is in `results/*.jsonl`.

**Reporter's gist, unmodified** (`results/gist-at-pinned-sha.jsonl`). The results match the reporter's recorded "current" outputs exactly:

- Duplicate STS requests: 2, 2 and 10.
- `hang`: still pending after 3000 ms, 1 STS request.
- `fail`: token issued, 2 STS requests.
- `timeout-warn`: still pending, with a warning logged.
- `timeout-throw`: token issued after fallback.

**#8358 sweep** (`repro/repro-8358-duplicates.cjs`). The table shows STS requests excluding the cache fill:

| Remaining | 1 call | 10 concurrent | 5 sequential, STS failing |
|---|---:|---:|---:|
| 20 min | 0 | 0 | 0 |
| 10 min | 1 | 1 | 5 (1 per call) |
| 4 min | **2** | **2** | **10 (2 per call)** |

The duplicate appears *only* below 5 min, where the memoizer's passive refresh and the signer's forced refresh overlap. Concurrent calls already coalesce onto one forced lock. In the healthy cases the token is signed with the refreshed credentials; in the failing cases, with the cached ones.

**#8359 stall** (`repro/repro-8359-stall.cjs`):

- **Phase A.** 10 min left and STS stalls. Call A is pending after 3 s, with 1 STS request. A plain `credentials()` call returns the valid cached credentials in 0 ms.
- **Phase B.** STS is healthy again. A new call B is **also pending** after 3 s, and STS still shows 1 request in total: B joined the stalled `forceRefreshLock` and never reached STS. *Recovery of STS does not unblock anything.*
- **Phase C.** I destroy the stalled socket. A and B both resolve within 500 ms, falling back to the cached `ASIAFAKE0001`. Only a transport error ends the stall.
- **Phase D.** 4 min left and STS stalls. The call is pending, with 2 stalled requests (passive + forced).

**Expired-credential fallback** (`repro/repro-expired-fallback.cjs`). This is a latent defect the issue only hints at:

- **Case 1.** The credentials expire in 3 s, and STS answers 503 after 4 s. `getAuthToken()` *succeeds* after 4.0 s, with a token signed by credentials that **expired 1028 ms before it was returned**. No error is raised, and the token is dead on arrival.
- **Case 2.** A custom, non-memoized provider returns already-expired credentials, and its forced refresh fails. The signer issues a token signed with the already-expired credentials.

**Baseline tests.** rds-signer passes 14/14 and credential-provider-node passes 23/23 (`results/baseline-tests-*.txt`).

## What I think the correct design is

Since #8054, early refresh has been an *optimisation*: it aims for a token that lives the full 15 minutes. It must never be the reason a caller with usable credentials gets no token. So for #8359:

- The signer should **bound its wait** on the forced refresh with a short deadline (a few seconds; a constant or a config option are both fine). The timer must be cleared, or `unref`'d, when the refresh wins.
- When the deadline passes or the refresh fails, the signer should **check the expiry of the cached credentials at fallback time**, not at call time. It falls back only if they are still valid.
- Credentials that are already expired, or that expired during the wait, must never be returned. In that case the signer should keep waiting or surface the error; both are acceptable.
- Providers cannot be cancelled, so the abandoned refresh keeps running in the background. It must have a rejection handler, so it can never become an `unhandledRejection`. If it later succeeds, the memoizer caches the result and the next call benefits.
- Ideally, a call that finds a refresh already in flight, one that an earlier call already gave up on, does not wait the full deadline again. Otherwise every new pool connection pays the deadline for as long as STS is stalled.

**#8358 is a memoizer defect.** A forced call that arrives while a passive or active refresh is in flight should **join** it rather than start a second chain call. It still has to see that refresh's *error*; today the passive promise swallows errors, so the unswallowed promise must be kept separately. Likewise, no passive refresh should start while a forced one is in flight. Joining also has to respect the caller's options: the passive refresh was started without `forceRefresh`. A signer-only alternative is to remember the last-seen expiry and issue just the forced call. That is acceptable if the counts drop to one, but it is the shallower fix.

**The trade-off any good answer should name.** A token presigned with temporary credentials is valid only until those credentials expire (this was #8047). Falling back during an outage is still the right call: pools such as `pg-pool` use the token immediately, and a short-lived token beats no token. But callers that cache tokens for close to 15 minutes will get one that dies early. So the fallback should be deliberate and visible, ideally through a logger warning. The deadline must also be long enough that a healthy STS round trip (roughly 100–500 ms, plus retries) normally wins.

**What must not regress.**

- Healthy early refresh still produces a ≥ 15-minute token, so #8047 is not reintroduced.
- Static credential objects stay unwrapped.
- Credentials without an expiration never trigger a refresh.
- `identityProperties` are still forwarded.
- Concurrent forced calls stay coalesced.
- The existing `Signer.spec.ts` and `memoize-chain.spec.ts` keep passing.

## Draft "reasonable but different" list (to finalise in Phase 2)

- **Where the bound lives.** In the signer (expected), or as a provider-level timeout, provided the signer's default path is bounded and other SDK clients are not affected.
- **Deadline.** A fixed constant or configurable, with any value in the low seconds. Capping it by the remaining lifetime is also fine.
- **On deadline with expired cached credentials.** Continue awaiting, or reject with a clear error. Both are fine; returning expired credentials is not.
- **#8358.** Join the refresh in the memoizer (preferred), or avoid the double call in the signer. Either is fine if the duplicate count goes from 2 to 1 and errors still reach the forced caller.
- **Fallback warning.** Logging one is nice to have, not required.

## Draft "looks done but isn't" list

- `Promise.race` with a timer that is never cleared, which holds the event loop open for the full deadline and leaks across tests.
- The abandoned refresh promise has no rejection handler.
- The fallback returns the credentials captured before the wait, with no fresh expiry check (today's behaviour).
- A signer-level lock or cache that keeps a rejected or stalled promise, or never clears on rejection (cache poisoning).
- The forced call joins the passive refresh but loses its error, so it resolves silently with stale credentials.
- A deadline so short that a healthy refresh always loses, or early refresh removed altogether (reintroducing #8047).
- Tests that only mock a *rejection* and never a *stall*, or that wait on real timers.
