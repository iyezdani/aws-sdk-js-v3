# Evaluation harness

This harness implements the scored rows of [../rubric.md](../rubric.md). Each test title starts with its row ID.

```sh
bash assessment/harness/run.sh <label>     # from Git Bash; results go to assessment/results/<label>/
```

`run.sh` does the following:

1. Rebuilds `credential-provider-node` and `rds-signer`, using the Windows shim from `phase1/tooling`.
2. Runs both existing package suites (layer 1).
3. Runs the real-time checks against `dist` (layer 3).
4. Runs this Vitest harness against source (layer 2).
5. Writes `summary.md`, the row table plus the informational measurements.

| File | Rows | Mode |
|---|---|---|
| `signer-early-refresh.spec.ts` | R1–R9, R11, I1–I8 | fake timers, real `Signer` + real `memoizeChain`, scripted credential sources |
| `duplicate-refresh.spec.ts` | R10a–e, I7b | real timers, real default chain (source) + STS client over HTTP, loopback fake STS |
| `realtime-check.cjs` | R1, R2, R3, R4, R9 (layer 3) | real time, built `dist`, 30 s windows |

**Design constraints** (see the rubric's scoring policy):

- Black-box only. The harness assumes no option names, no deadline value (only the 30 s upper and 500 ms lower bounds), no error text and no internals of a fix.
- A token's signing credentials are read from `X-Amz-Credential`.
- No network: STS is a loopback server, and all `AWS_*` variables are replaced inside the end-to-end spec's own process.

**Validation:**

- `results/baseline/` is the pinned code. It fails R1, R2, R4, R5, R8, R9 and R10, and passes R3, R6, R7 and R11.
- `results/reference/` is the reference fix on the local `assessment-reference` branch. It passes every scored row.
- Validating against the reference found one harness bug: R8 started its next call in the same microtask as the late settlement. It was fixed by letting simulated time pass, which is what "later" means in the rubric.

To apply a model's output, see [../run-protocol.md](../run-protocol.md).
