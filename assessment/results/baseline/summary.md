| Row | Result | Tests passed | First failure |
|---|---|---|---|
| R1 | FAIL | 0/2 | R1 [plain] token is signed with the cached credentials within 30 s: AssertionError: R1 plain: getAuthToken() still pending: expected false to be true // Object.is equality |
| R2 | FAIL | 0/1 | R2 [chain] 4 min left, passive and forced refresh both stall: cached token within 30 s: AssertionError: R2: getAuthToken() still pending: expected false to be true // Object.is equality |
| R3 | PASS | 3/3 |  |
| R4 | FAIL | 1/3 | R4 [plain] 2 s left, refresh fails after 4 s: never a token signed with expired credentials: AssertionError: R4 plain: token signed with CACHED after 4000ms: expected true to be false // Object.is equality |
| R5 | FAIL | 2/3 | R5 [plain] expired 1 min ago, refresh fails: never signed with the expired credentials: AssertionError: R5 fail: token signed with EXPIRED after 0ms: expected true to be false // Object.is equality |
| R6 | PASS | 3/3 |  |
| R7 | PASS | 2/2 |  |
| R8 | FAIL | 0/3 | R8 [plain] timed-out refresh later rejects: next call (STS healthy) uses fresh credentials: AssertionError: R8 plain call A: getAuthToken() still pending: expected false to be true // Object.is equality |
| R9 | FAIL | 1/3 | R9 [plain] 10 concurrent calls during a stall all get cached tokens within 30 s: AssertionError: R9 plain call 0: getAuthToken() still pending: expected false to be true // Object.is equality |
| R10 | FAIL | 2/5 | R10a 4 min left, 1 call, STS healthy: exactly 1 STS request: AssertionError: expected 2 to be 1 // Object.is equality |
| R11 | PASS | 4/4 |  |
| I2 | recorded | 1/1 |  |
| I3 | recorded | 1/1 |  |
| I4 | recorded | 1/1 |  |
| I5 | recorded | 1/1 |  |
| I6 | recorded | 1/1 |  |
| I7 | recorded | 2/2 |  |
| I8 | recorded | 1/1 |  |

**Informational measurements**

```json
{
  "R10a.stsRequests": 2,
  "R10b.stsRequests": 2,
  "R10c": {
    "stsRequests": 10,
    "keys": [
      "ASIAFAKE0007",
      "ASIAFAKE0007",
      "ASIAFAKE0007",
      "ASIAFAKE0007",
      "ASIAFAKE0007"
    ]
  },
  "R10d": {
    "stsRequests": 1,
    "signedWith": "ASIAFAKE0009",
    "cachedKey": "ASIAFAKE0008"
  },
  "R10e.forcedCallerOutcome": "rejected",
  "I7b.linkCallsAfterWarm": 2,
  "I1.fallbackMs.plain": "pending>30000",
  "I1.fallbackMs.chain": "pending>30000",
  "R2.refreshCalls": 2,
  "R4.plainSlowFail": "token signed with CACHED after 4000ms",
  "R4.chainSlowFail": "token signed with CACHED after 4000ms",
  "R4.plainStall": "pending",
  "R5.fail": "token signed with EXPIRED after 0ms",
  "R5.stall": "pending",
  "R7.plain": {
    "before": 1,
    "after": 1,
    "keys": [
      "FRESH6",
      "FRESH7",
      "FRESH8"
    ]
  },
  "R7.chain": {
    "before": 1,
    "after": 1,
    "keys": [
      "FRESH9",
      "FRESH9",
      "FRESH9"
    ]
  },
  "I2.sequentialLatenciesMs": [
    "pending>30000"
  ],
  "I3.recovery": {
    "callA": "pending",
    "callB": "pending",
    "refreshCalls": 1
  },
  "I4.forcedCallsFor10Concurrent": 10,
  "I5.consoleOnFallback": {
    "outcome": "pending",
    "calls": []
  },
  "I6.pendingFakeTimers": {
    "outcome": "token signed with FRESH21 after 500ms",
    "timers": 0
  },
  "I7.refreshCalls": 2,
  "I8.signedWith": "token signed with CACHED after 500ms"
}
```

Vitest: 26 passed, 14 failed, 40 total.
