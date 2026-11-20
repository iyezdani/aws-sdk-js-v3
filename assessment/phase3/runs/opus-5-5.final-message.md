A stalled early refresh can no longer block `getAuthToken()`. If the cached credentials are still valid, it waits at most 5 seconds for the refresh and then signs with the cached credentials. All 20 package tests pass, the type check is clean and oxlint reports nothing.

**Cause.** In `packages/rds-signer/src/Signer.ts`, the credentials wrapper ran `await provider({ forceRefresh: true })` with no time limit when cached credentials expired within 15 minutes. The early refresh is meant to be an optional improvement (a full 15-minute token instead of a shorter one), but it was a hard dependency. A stalled STS call meant the promise never settled, the existing `try/catch` never ran, and the signer never finished.

**What changed:**
- **Time limit on the refresh.** While the cached credentials are still valid, the refresh races a timer of 5 seconds, or the credentials' remaining lifetime if that's shorter. If the timer wins, the token is signed with the cached credentials. That still gives a valid token, just one that may expire before 15 minutes. The timer is cleared afterwards so it doesn't keep a Node process alive.
- **One refresh at a time.** A refresh still in progress is reused by later calls instead of starting a new one. Without this, an app calling `getAuthToken()` repeatedly during an STS outage would pile up a new stuck request on every call. Once a refresh succeeds or fails, the next call can start a new one.
- **Errors still fall back.** A failed refresh falls back to the cached credentials, as before. The timer never rejects, so a refresh that fails after the timeout causes no unhandled rejection.
- **Already-expired credentials still wait.** In that case the refresh is the only way to get usable credentials, so signing waits for it with no limit, as before. That's the one remaining unbounded wait, and it belongs to the underlying credential provider.

The 5-second limit is a private constant, so the public API is unchanged. If you'd rather let users set it, it could become an option on `SignerConfig`.

**Tests.** I added six tests in `packages/rds-signer/src/Signer.spec.ts`, using fake timers:
- `getAuthToken()` still waits at 4,999 ms, then resolves with the cached credentials at 5,000 ms when the refresh never finishes, with no timers left running.
- A refresh that finishes before the limit still returns the new credentials.
- The wait is cut to the remaining lifetime when credentials expire in under 5 seconds.
- A stuck refresh is reused, not restarted.
- A new refresh starts after a failed one.
- Already-expired credentials still wait for the refresh.

Against the original `Signer.ts`, the three tests that use a refresh that never finishes all fail by hanging, so they catch the bug.

**Formatting.** I ran the repo's formatter (oxfmt) on both files, which also switched their line endings from CRLF to LF on disk. Git normalizes line endings on commit, so it makes no difference to the committed files. Nothing is committed yet.
