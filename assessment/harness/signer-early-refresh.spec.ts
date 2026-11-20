// Rubric rows R1-R9, R11 and informational rows I1-I8 (see assessment/rubric.md).
// Every test title starts with its row id; run.sh aggregates results per row.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  advanceUntil,
  BOUND_MS,
  captureUnhandled,
  chainProvider,
  controlled,
  creds,
  describeOutcome,
  HEALTHY_LATENCY_MS,
  issued,
  liveTimers,
  MIN,
  plainProvider,
  realTurn,
  rejectAfter,
  rejectNow,
  resolveAfter,
  sequence,
  signedWithExpired,
  signerFor,
  signingKey,
  stall,
  T0,
  track,
} from "./helpers";
import { flushInfo, record } from "./info";

beforeEach(() => {
  issued.clear();
  vi.useFakeTimers({ now: T0 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(() => flushInfo(__filename));

const expectTokenFrom = (t: { settled: boolean; ok?: boolean; value?: string }, keyPrefix: string, label: string) => {
  expect(t.settled, `${label}: getAuthToken() still pending`).toBe(true);
  expect(t.ok, `${label}: getAuthToken() rejected`).toBe(true);
  expect(signingKey(t.value), `${label}: wrong signing credentials`).toMatch(new RegExp(`^${keyPrefix}`));
};

describe("R1 bounded wait: 10 min left, forced refresh stalls", () => {
  it("R1 [plain] token is signed with the cached credentials within 30 s", async () => {
    const p = plainProvider(creds("CACHED", 10 * MIN), stall);
    const t = track(signerFor(p.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    record("I1.fallbackMs.plain", t.settled ? t.elapsedMs : `pending>${BOUND_MS}`);
    expectTokenFrom(t, "CACHED", "R1 plain");
  });

  it("R1 [chain] token is signed with the cached credentials within 30 s", async () => {
    const c = chainProvider(creds("CACHED", 10 * MIN), stall);
    await c.warm();
    const t = track(signerFor(c.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    record("I1.fallbackMs.chain", t.settled ? t.elapsedMs : `pending>${BOUND_MS}`);
    expectTokenFrom(t, "CACHED", "R1 chain");
  });
});

describe("R2 bounded wait inside the memoizer's passive window", () => {
  it("R2 [chain] 4 min left, passive and forced refresh both stall: cached token within 30 s", async () => {
    const c = chainProvider(creds("CACHED", 4 * MIN), stall);
    await c.warm();
    const t = track(signerFor(c.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    record("R2.refreshCalls", c.refreshes.count);
    expectTokenFrom(t, "CACHED", "R2");
  });
});

describe("R3 a healthy early refresh still wins", () => {
  it("R3 [plain] 10 min left, refresh completes after 500 ms: signed with refreshed credentials", async () => {
    const p = plainProvider(creds("CACHED", 10 * MIN), resolveAfter(HEALTHY_LATENCY_MS));
    const t = track(signerFor(p.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    expectTokenFrom(t, "FRESH", "R3 plain");
  });

  it("R3 [chain] 10 min left, refresh completes after 500 ms: signed with refreshed credentials", async () => {
    const c = chainProvider(creds("CACHED", 10 * MIN), resolveAfter(HEALTHY_LATENCY_MS));
    await c.warm();
    const t = track(signerFor(c.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    expectTokenFrom(t, "FRESH", "R3 chain 10min");
  });

  it("R3 [chain] 4 min left, refresh completes after 500 ms: signed with refreshed credentials", async () => {
    const c = chainProvider(creds("CACHED", 4 * MIN), resolveAfter(HEALTHY_LATENCY_MS));
    await c.warm();
    const t = track(signerFor(c.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    expectTokenFrom(t, "FRESH", "R3 chain 4min");
  });
});

describe("R4 expiry is re-checked at fallback (credentials expire during the wait)", () => {
  it("R4 [plain] 2 s left, refresh fails after 4 s: never a token signed with expired credentials", async () => {
    const p = plainProvider(creds("CACHED", 2_000), rejectAfter(4_000));
    const t = track(signerFor(p.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    record("R4.plainSlowFail", describeOutcome(t));
    expect(signedWithExpired(t), `R4 plain: ${describeOutcome(t)}`).toBe(false);
  });

  it("R4 [chain] 2 s left, refresh fails after 4 s: never a token signed with expired credentials", async () => {
    const c = chainProvider(creds("CACHED", 2_000), rejectAfter(4_000));
    await c.warm();
    const t = track(signerFor(c.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    record("R4.chainSlowFail", describeOutcome(t));
    expect(signedWithExpired(t), `R4 chain: ${describeOutcome(t)}`).toBe(false);
  });

  it("R4 [plain] 2 s left, refresh stalls: never a token signed with expired credentials", async () => {
    const p = plainProvider(creds("CACHED", 2_000), stall);
    const t = track(signerFor(p.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    record("R4.plainStall", describeOutcome(t));
    expect(signedWithExpired(t), `R4 plain stall: ${describeOutcome(t)}`).toBe(false);
  });
});

describe("R5 already-expired credentials", () => {
  it("R5 [plain] expired 1 min ago, refresh fails: never signed with the expired credentials", async () => {
    const p = plainProvider(creds("EXPIRED", -1 * MIN), rejectNow());
    const t = track(signerFor(p.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    record("R5.fail", describeOutcome(t));
    expect(signedWithExpired(t), `R5 fail: ${describeOutcome(t)}`).toBe(false);
  });

  it("R5 [plain] expired 1 min ago, refresh stalls: never signed with the expired credentials", async () => {
    const p = plainProvider(creds("EXPIRED", -1 * MIN), stall);
    const t = track(signerFor(p.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    record("R5.stall", describeOutcome(t));
    expect(signedWithExpired(t), `R5 stall: ${describeOutcome(t)}`).toBe(false);
  });

  it("R5 [plain] expired 1 min ago, refresh succeeds after 500 ms: signed with the refreshed credentials", async () => {
    const p = plainProvider(creds("EXPIRED", -1 * MIN), resolveAfter(HEALTHY_LATENCY_MS));
    const t = track(signerFor(p.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    expectTokenFrom(t, "FRESH", "R5 success");
  });
});

describe("R6 an abandoned refresh that later rejects raises no unhandled rejection", () => {
  const scenario = async (kind: "plain" | "chain", minutesLeft: number) => {
    const unhandled = captureUnhandled();
    try {
      const ctl = controlled();
      const cached = creds("CACHED", minutesLeft * MIN);
      let fn;
      if (kind === "plain") {
        fn = plainProvider(cached, ctl.refresh).fn;
      } else {
        const c = chainProvider(cached, ctl.refresh);
        await c.warm();
        fn = c.fn;
      }
      const t = track(signerFor(fn).getAuthToken());
      await advanceUntil(() => t.settled);
      ctl.reject(new Error("late refresh failure"));
      await realTurn();
      return unhandled.list;
    } finally {
      unhandled.stop();
    }
  };

  it("R6 [plain] 10 min left", async () => {
    expect(await scenario("plain", 10)).toEqual([]);
  });
  it("R6 [chain] 10 min left", async () => {
    expect(await scenario("chain", 10)).toEqual([]);
  });
  it("R6 [chain] 4 min left (passive + forced)", async () => {
    expect(await scenario("chain", 4)).toEqual([]);
  });
});

describe("R7 no ref'd timer is left behind after a healthy refresh", () => {
  const scenario = async (kind: "plain" | "chain") => {
    vi.useRealTimers();
    const cached = creds("CACHED", 10 * MIN);
    let fn;
    if (kind === "plain") {
      fn = plainProvider(cached, resolveAfter(10)).fn;
    } else {
      const c = chainProvider(cached, resolveAfter(10));
      await c.warm();
      fn = c.fn;
    }
    const before = liveTimers();
    const signer = signerFor(fn);
    const keys: (string | undefined)[] = [];
    for (let i = 0; i < 3; i++) keys.push(signingKey(await signer.getAuthToken()));
    await new Promise((r) => setImmediate(r));
    return { before, after: liveTimers(), keys };
  };

  it("R7 [plain] three sequential calls leave no extra live timers", async () => {
    const r = await scenario("plain");
    record("R7.plain", r);
    expect(r.after, `live timers before=${r.before} after=${r.after}`).toBeLessThanOrEqual(r.before);
  });
  it("R7 [chain] three sequential calls leave no extra live timers", async () => {
    const r = await scenario("chain");
    record("R7.chain", r);
    expect(r.after, `live timers before=${r.before} after=${r.after}`).toBeLessThanOrEqual(r.before);
  });
});

describe("R8 no stuck lock or stale cache after a timed-out refresh", () => {
  it("R8 [plain] timed-out refresh later rejects: next call (STS healthy) uses fresh credentials", async () => {
    const ctl = controlled();
    const p = plainProvider(creds("CACHED", 10 * MIN), sequence(ctl.refresh, resolveAfter(HEALTHY_LATENCY_MS)));
    const signer = signerFor(p.fn);
    const a = track(signer.getAuthToken());
    await advanceUntil(() => a.settled);
    expectTokenFrom(a, "CACHED", "R8 plain call A");
    ctl.reject(new Error("late refresh failure"));
    const b = track(signer.getAuthToken());
    await advanceUntil(() => b.settled);
    expectTokenFrom(b, "FRESH", "R8 plain call B");
  });

  it("R8 [chain] timed-out refresh later rejects: next call (STS healthy) uses fresh credentials", async () => {
    const ctl = controlled();
    const c = chainProvider(creds("CACHED", 10 * MIN), sequence(ctl.refresh, resolveAfter(HEALTHY_LATENCY_MS)));
    await c.warm();
    const signer = signerFor(c.fn);
    const a = track(signer.getAuthToken());
    await advanceUntil(() => a.settled);
    expectTokenFrom(a, "CACHED", "R8 chain call A");
    ctl.reject(new Error("late refresh failure"));
    const b = track(signer.getAuthToken());
    await advanceUntil(() => b.settled);
    expectTokenFrom(b, "FRESH", "R8 chain call B");
  });

  it("R8 [chain] timed-out refresh later succeeds: next call uses those credentials without another refresh", async () => {
    const ctl = controlled();
    const c = chainProvider(creds("CACHED", 10 * MIN), sequence(ctl.refresh, resolveAfter(HEALTHY_LATENCY_MS)));
    await c.warm();
    const signer = signerFor(c.fn);
    const a = track(signer.getAuthToken());
    await advanceUntil(() => a.settled);
    expectTokenFrom(a, "CACHED", "R8 chain call A");
    ctl.resolve(creds("LATE", 60 * MIN));
    const b = track(signer.getAuthToken());
    await advanceUntil(() => b.settled);
    expectTokenFrom(b, "LATE", "R8 chain call B");
    expect(c.refreshes.count, "refreshes after the late success").toBe(1);
  });
});

describe("R9 concurrency", () => {
  it("R9 [plain] 10 concurrent calls during a stall all get cached tokens within 30 s", async () => {
    const p = plainProvider(creds("CACHED", 10 * MIN), stall);
    const signer = signerFor(p.fn);
    const ts = Array.from({ length: 10 }, () => track(signer.getAuthToken()));
    await advanceUntil(() => ts.every((t) => t.settled));
    ts.forEach((t, i) => expectTokenFrom(t, "CACHED", `R9 plain call ${i}`));
  });

  it("R9 [chain] 10 concurrent calls during a stall all get cached tokens within 30 s", async () => {
    const c = chainProvider(creds("CACHED", 10 * MIN), stall);
    await c.warm();
    const signer = signerFor(c.fn);
    const ts = Array.from({ length: 10 }, () => track(signer.getAuthToken()));
    await advanceUntil(() => ts.every((t) => t.settled));
    ts.forEach((t, i) => expectTokenFrom(t, "CACHED", `R9 chain call ${i}`));
  });

  it("R9 [chain] 10 concurrent calls with a healthy refresh share exactly 1 refresh", async () => {
    const c = chainProvider(creds("CACHED", 10 * MIN), resolveAfter(HEALTHY_LATENCY_MS));
    await c.warm();
    const signer = signerFor(c.fn);
    const ts = Array.from({ length: 10 }, () => track(signer.getAuthToken()));
    await advanceUntil(() => ts.every((t) => t.settled));
    ts.forEach((t, i) => expectTokenFrom(t, "FRESH", `R9 healthy call ${i}`));
    expect(c.refreshes.count).toBe(1);
  });
});

describe("R11 no regressions in the existing early-refresh behaviour", () => {
  it("R11 static credential object is used as-is", async () => {
    const t = track(signerFor(creds("STATIC", 2 * MIN)).getAuthToken());
    await advanceUntil(() => t.settled);
    expectTokenFrom(t, "STATIC", "R11 static");
  });

  it("R11 [plain] credentials without expiration: no forced refresh", async () => {
    const p = plainProvider(creds("NOEXP"), resolveAfter(HEALTHY_LATENCY_MS));
    const t = track(signerFor(p.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    expectTokenFrom(t, "NOEXP", "R11 no expiration");
    expect(p.calls.force).toBe(0);
  });

  it("R11 [plain] 20 min left: no forced refresh", async () => {
    const p = plainProvider(creds("LONG", 20 * MIN), resolveAfter(HEALTHY_LATENCY_MS));
    const t = track(signerFor(p.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    expectTokenFrom(t, "LONG", "R11 20 min");
    expect(p.calls.force).toBe(0);
  });

  it("R11 [chain] 20 min left: no refresh at all", async () => {
    const c = chainProvider(creds("LONG", 20 * MIN), resolveAfter(HEALTHY_LATENCY_MS));
    await c.warm();
    const t = track(signerFor(c.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    expectTokenFrom(t, "LONG", "R11 chain 20 min");
    expect(c.refreshes.count).toBe(0);
  });
});

describe("Informational rows (recorded, never fail)", () => {
  it("I2 sequential outage cost: 5 calls in a row while the refresh stalls", async () => {
    const c = chainProvider(creds("CACHED", 10 * MIN), stall);
    await c.warm();
    const signer = signerFor(c.fn);
    const latencies: (number | string)[] = [];
    for (let i = 0; i < 5; i++) {
      const t = track(signer.getAuthToken());
      await advanceUntil(() => t.settled);
      latencies.push(t.settled ? (t.elapsedMs as number) : `pending>${BOUND_MS}`);
      if (!t.settled) break;
    }
    record("I2.sequentialLatenciesMs", latencies);
  });

  it("I3 after STS recovers, does a new call get fresh credentials?", async () => {
    const c = chainProvider(creds("CACHED", 10 * MIN), sequence(stall, resolveAfter(HEALTHY_LATENCY_MS)));
    await c.warm();
    const signer = signerFor(c.fn);
    const a = track(signer.getAuthToken());
    await advanceUntil(() => a.settled);
    const b = track(signer.getAuthToken());
    await advanceUntil(() => b.settled);
    record("I3.recovery", { callA: describeOutcome(a), callB: describeOutcome(b), refreshCalls: c.refreshes.count });
  });

  it("I4 signer-level coalescing for a non-memoized provider (10 concurrent, healthy)", async () => {
    const p = plainProvider(creds("CACHED", 10 * MIN), resolveAfter(HEALTHY_LATENCY_MS));
    const signer = signerFor(p.fn);
    const ts = Array.from({ length: 10 }, () => track(signer.getAuthToken()));
    await advanceUntil(() => ts.every((t) => t.settled));
    record("I4.forcedCallsFor10Concurrent", p.calls.force);
  });

  it("I5 is anything logged on fallback?", async () => {
    const spies = (["warn", "error", "info", "log", "debug"] as const).map((m) => vi.spyOn(console, m));
    const p = plainProvider(creds("CACHED", 10 * MIN), stall);
    const t = track(signerFor(p.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    const calls = spies.flatMap((s, i) =>
      s.mock.calls.map((args) => `${["warn", "error", "info", "log", "debug"][i]}: ${String(args[0]).slice(0, 160)}`)
    );
    spies.forEach((s) => s.mockRestore());
    record("I5.consoleOnFallback", { outcome: describeOutcome(t), calls });
  });

  it("I6 fake-timer count after a healthy refresh (includes unref'd timers)", async () => {
    const p = plainProvider(creds("CACHED", 10 * MIN), resolveAfter(HEALTHY_LATENCY_MS));
    const t = track(signerFor(p.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    record("I6.pendingFakeTimers", { outcome: describeOutcome(t), timers: vi.getTimerCount() });
  });

  it("I7 memoizer: plain call within 5 min while a forced refresh is in flight", async () => {
    const c = chainProvider(creds("CACHED", 4 * MIN), resolveAfter(HEALTHY_LATENCY_MS));
    await c.warm();
    const forced = (c.fn as any)({ forceRefresh: true });
    await (c.fn as any)();
    await advanceUntil(() => false, 2 * HEALTHY_LATENCY_MS);
    await forced;
    record("I7.refreshCalls", c.refreshes.count);
  });

  it("I8 refresh returns credentials that still expire within 15 min: which set signs?", async () => {
    const p = plainProvider(
      creds("CACHED", 2 * MIN),
      resolveAfter(HEALTHY_LATENCY_MS, () => creds("SHORTFRESH", 10 * MIN))
    );
    const t = track(signerFor(p.fn).getAuthToken());
    await advanceUntil(() => t.settled);
    record("I8.signedWith", describeOutcome(t));
  });
});
