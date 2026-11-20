| Row | Result | Tests passed | First failure |
|---|---|---|---|
| R1 | PASS | 2/2 |  |
| R2 | PASS | 1/1 |  |
| R3 | PASS | 3/3 |  |
| R4 | PASS | 3/3 |  |
| R5 | PASS | 3/3 |  |
| R6 | PASS | 3/3 |  |
| R7 | PASS | 2/2 |  |
| R8 | PASS | 3/3 |  |
| R9 | PASS | 3/3 |  |
| R10 | PASS | 5/5 |  |
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
  "R10a.stsRequests": 1,
  "R10b.stsRequests": 1,
  "R10c": {
    "stsRequests": 5,
    "keys": [
      "ASIAFAKE0005",
      "ASIAFAKE0005",
      "ASIAFAKE0005",
      "ASIAFAKE0005",
      "ASIAFAKE0005"
    ]
  },
  "R10d": {
    "stsRequests": 1,
    "signedWith": "ASIAFAKE0007",
    "cachedKey": "ASIAFAKE0006"
  },
  "R10e.forcedCallerOutcome": "rejected",
  "I7b.linkCallsAfterWarm": 1,
  "I1.fallbackMs.plain": 5000,
  "I1.fallbackMs.chain": 5000,
  "R2.refreshCalls": 1,
  "R4.plainSlowFail": "rejected after 4000ms: @aws-sdk/rds-signer - cached credentials expired before a refresh completed.",
  "R4.chainSlowFail": "rejected after 4000ms: @aws-sdk/rds-signer - cached credentials expired before a refresh completed.",
  "R4.plainStall": "rejected after 5000ms: @aws-sdk/rds-signer - cached credentials expired before a refresh completed.",
  "R5.fail": "rejected after 0ms: synthetic refresh failure",
  "R5.stall": "pending",
  "R7.plain": {
    "before": 1,
    "after": 1,
    "keys": [
      "FRESH5",
      "FRESH6",
      "FRESH7"
    ]
  },
  "R7.chain": {
    "before": 1,
    "after": 1,
    "keys": [
      "FRESH8",
      "FRESH8",
      "FRESH8"
    ]
  },
  "I2.sequentialLatenciesMs": [
    5000,
    0,
    0,
    0,
    0
  ],
  "I3.recovery": {
    "callA": "token signed with CACHED after 5000ms",
    "callB": "token signed with CACHED after 0ms",
    "refreshCalls": 1
  },
  "I4.forcedCallsFor10Concurrent": 1,
  "I5.consoleOnFallback": {
    "outcome": "token signed with CACHED after 5000ms",
    "calls": []
  },
  "I6.pendingFakeTimers": {
    "outcome": "token signed with FRESH13 after 500ms",
    "timers": 0
  },
  "I7.refreshCalls": 1,
  "I8.signedWith": "token signed with CACHED after 500ms"
}
```

Vitest: 40 passed, 0 failed, 40 total.
