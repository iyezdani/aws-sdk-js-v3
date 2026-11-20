| Row | Result | Tests passed | First failure |
|---|---|---|---|
| R1 | PASS | 2/2 |  |
| R2 | PASS | 1/1 |  |
| R3 | PASS | 3/3 |  |
| R4 | FAIL | 0/3 | R4 [plain] 2 s left, refresh fails after 4 s: never a token signed with expired credentials: AssertionError: R4 plain: token signed with CACHED after 4000ms: expected true to be false // Object.is equality |
| R5 | FAIL | 1/3 | R5 [plain] expired 1 min ago, refresh fails: never signed with the expired credentials: AssertionError: R5 fail: token signed with EXPIRED after 0ms: expected true to be false // Object.is equality |
| R6 | PASS | 3/3 |  |
| R7 | PASS | 2/2 |  |
| R8 | PASS | 3/3 |  |
| R9 | PASS | 3/3 |  |
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
  "I1.fallbackMs.plain": 5000,
  "I1.fallbackMs.chain": 5000,
  "R2.refreshCalls": 2,
  "R4.plainSlowFail": "token signed with CACHED after 4000ms",
  "R4.chainSlowFail": "token signed with CACHED after 4000ms",
  "R4.plainStall": "token signed with CACHED after 5000ms",
  "R5.fail": "token signed with EXPIRED after 0ms",
  "R5.stall": "token signed with EXPIRED after 5000ms",
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
    5000,
    5000,
    5000,
    5000,
    5000
  ],
  "I3.recovery": {
    "callA": "token signed with CACHED after 5000ms",
    "callB": "token signed with CACHED after 5000ms",
    "refreshCalls": 1
  },
  "I4.forcedCallsFor10Concurrent": 10,
  "I5.consoleOnFallback": {
    "outcome": "token signed with CACHED after 5000ms",
    "calls": []
  },
  "I6.pendingFakeTimers": {
    "outcome": "token signed with FRESH23 after 500ms",
    "timers": 0
  },
  "I7.refreshCalls": 2,
  "I8.signedWith": "token signed with CACHED after 500ms"
}
```

Vitest: 32 passed, 8 failed, 40 total.
