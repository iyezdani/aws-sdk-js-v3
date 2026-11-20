// Phase 4 probes: targeted checks for issues found in manual review that the rubric harness does
// not measure directly. They record outcomes rather than assert, so every branch can be compared.
// Run: yarn vitest run -c assessment/phase4/probes/vitest.config.mts
import { afterAll, afterEach, beforeEach, describe, it, vi } from "vitest";

import {
  advance,
  advanceUntil,
  creds,
  describeOutcome,
  issued,
  MIN,
  plainProvider,
  resolveAfter,
  sequence,
  signerFor,
  stall,
  T0,
  track,
} from "../../harness/helpers";
import { flushInfo, record } from "../../harness/info";

beforeEach(() => {
  issued.clear();
  vi.useFakeTimers({ now: T0 });
});
afterEach(() => vi.useRealTimers());
afterAll(() => flushInfo(__filename));

describe("probes", () => {
  it("P1 refresh stalls forever, cached credentials then expire, STS has recovered: does a new call recover?", async () => {
    // A non-memoized provider: plain calls keep returning the same (eventually expired) credentials;
    // forced refresh #1 stalls forever, any later forced refresh succeeds after 500 ms.
    const p = plainProvider(creds("CACHED", 10 * MIN), sequence(stall, resolveAfter(500)));
    const signer = signerFor(p.fn);
    const a = track(signer.getAuthToken());
    await advanceUntil(() => a.settled, 30_000);
    await advance(11 * MIN); // the cached credentials are now expired
    const b = track(signer.getAuthToken());
    await advanceUntil(() => b.settled, 60_000);
    record("P1", { callA: describeOutcome(a), callB: describeOutcome(b), forcedRefreshCalls: p.calls.force });
  });

  it("P2 forced refresh always stalls: how many stuck refreshes do 5 sequential and 10 concurrent calls leave?", async () => {
    const seq = plainProvider(creds("CACHED", 10 * MIN), stall);
    const s1 = signerFor(seq.fn);
    const outcomes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const t = track(s1.getAuthToken());
      await advanceUntil(() => t.settled, 30_000);
      outcomes.push(describeOutcome(t));
    }
    const conc = plainProvider(creds("CACHED", 10 * MIN), stall);
    const s2 = signerFor(conc.fn);
    const ts = Array.from({ length: 10 }, () => track(s2.getAuthToken()));
    await advanceUntil(() => ts.every((t) => t.settled), 30_000);
    record("P2", {
      sequentialForcedCalls: seq.calls.force,
      concurrentForcedCalls: conc.calls.force,
      sequentialOutcomes: outcomes,
    });
  });

  it("P3 boundary: cached credentials with 4.9 s / 5.0 s / 6 s left, refresh stalls: what signs the token, and is it still valid?", async () => {
    const rows: Record<string, unknown> = {};
    for (const ms of [4_900, 5_000, 6_000]) {
      issued.clear();
      const cached = creds("CACHED", ms);
      const p = plainProvider(cached, stall);
      const t = track(signerFor(p.fn).getAuthToken());
      await advanceUntil(() => t.settled, 30_000);
      rows[`${ms}ms`] = {
        outcome: describeOutcome(t),
        validForMsAtReturn: t.settled && t.ok ? cached.expiration!.getTime() - (t.settledAt as number) : null,
      };
    }
    record("P3", rows);
  });
});
