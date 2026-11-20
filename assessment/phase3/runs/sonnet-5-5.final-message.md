A stalled early credential refresh no longer blocks `getAuthToken()`. After 5 seconds it gives up and signs with the cached credentials. All 13 tests in `Signer.spec.ts` pass, including two new ones. I didn't run lint or the type-check.

**The change** is in `packages/rds-signer/src/Signer.ts`, in the credentials wrapper:
- **Timeout:** the force-refresh call (`provider({ forceRefresh: true })`) now races against a 5-second timer (`REFRESH_TIMEOUT_MS`). If the timer wins, the wrapper catches the timeout like any other refresh failure and returns the original credentials.
- **Timer cleanup:** a `finally` block clears the timer, so a refresh that finishes in time leaves nothing pending and can't keep a Node process alive.
- **No unhandled rejection:** if the abandoned refresh later rejects, the race has already handled it.

**Why:** the early refresh only exists to make the token last its full 15 minutes. It was an optimisation sitting on the critical path with no time limit. The cached credentials were still valid, so the token could have been signed without waiting.

**Behaviour:** if the refresh stalls, the token is signed with the near-expiry cached credentials, so it may be shorter-lived than 15 minutes. That is the same fallback the code already used when the refresh threw. The initial, non-forced provider call is unchanged and still has no timeout.

I picked 5 seconds myself. It's a constant, so say if you'd rather have a different value.

**Tests** in `Signer.spec.ts`, both using fake timers:
- A refresh that never settles resolves to the original credentials after 5 seconds, and no timers are left behind.
- A refresh that completes normally returns the refreshed credentials and clears its timer.
