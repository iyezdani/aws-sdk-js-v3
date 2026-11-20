// Rubric row R10 (#8358, scored as thoroughness; R10e is a regression guard) and I-row I7b.
// End to end: real Signer + real default Node credential chain (from source) + real STS client over
// HTTP against a loopback fake STS. Real timers.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { credentialsTreatedAsExpired, defaultProvider } from "../../packages-internal/credential-provider-node/src/defaultProvider";
import { memoizeChain } from "../../packages-internal/credential-provider-node/src/runtime/memoize-chain";
import { type FakeSts, startFakeSts } from "./fake-sts";
import { MIN, signerFor, signingKey } from "./helpers";
import { flushInfo, record } from "./info";

let sts: FakeSts;
const savedEnv: Record<string, string | undefined> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  sts = await startFakeSts();
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("AWS_")) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  }
  Object.assign(process.env, sts.env);
});
afterAll(async () => {
  for (const k of Object.keys(sts.env)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  await sts.close();
  flushInfo(__filename);
});
beforeEach(() => {
  sts.state.mode = "ok";
  sts.state.delayMs = 5;
});

/** A fresh default chain whose cache holds credentials with `minutesLeft`; returns the cached key. */
async function warmChain(minutesLeft: number) {
  sts.state.lifetimeMs = minutesLeft * MIN;
  const credentials = defaultProvider();
  const cached = await credentials();
  sts.state.lifetimeMs = 60 * MIN;
  return { credentials, cachedKey: cached.accessKeyId, mark: sts.requests() };
}

describe("R10 #8358: one STS refresh per near-expiry window (end to end)", () => {
  it("R10a 4 min left, 1 call, STS healthy: exactly 1 STS request", async () => {
    const { credentials, mark } = await warmChain(4);
    const token = await signerFor(credentials).getAuthToken();
    await sleep(100);
    const n = sts.requests() - mark;
    record("R10a.stsRequests", n);
    expect(signingKey(token)).not.toBeUndefined();
    expect(n).toBe(1);
  });

  it("R10b 4 min left, 10 concurrent calls, STS healthy: exactly 1 STS request", async () => {
    const { credentials, mark } = await warmChain(4);
    const signer = signerFor(credentials);
    await Promise.all(Array.from({ length: 10 }, () => signer.getAuthToken()));
    await sleep(100);
    const n = sts.requests() - mark;
    record("R10b.stsRequests", n);
    expect(n).toBe(1);
  });

  it("R10c 4 min left, 5 sequential calls, STS failing: 1 request per call, all tokens from cached credentials", async () => {
    const { credentials, cachedKey, mark } = await warmChain(4);
    sts.state.mode = "fail";
    const signer = signerFor(credentials);
    const keys: (string | undefined)[] = [];
    for (let i = 0; i < 5; i++) {
      keys.push(signingKey(await signer.getAuthToken()));
      await sleep(20);
    }
    await sleep(100);
    const n = sts.requests() - mark;
    record("R10c", { stsRequests: n, keys });
    expect(keys).toEqual(Array(5).fill(cachedKey));
    expect(n).toBe(5);
  });

  it("R10d guard: 10 min left, 1 call, STS healthy: 1 early refresh and its credentials are used", async () => {
    const { credentials, cachedKey, mark } = await warmChain(10);
    const token = await signerFor(credentials).getAuthToken();
    await sleep(100);
    const n = sts.requests() - mark;
    record("R10d", { stsRequests: n, signedWith: signingKey(token), cachedKey });
    expect(n).toBe(1);
    expect(signingKey(token)).not.toBe(cachedKey);
  });

  it("R10e guard: a forced caller still sees the refresh error when STS fails (4 min left)", async () => {
    const { credentials } = await warmChain(4);
    sts.state.mode = "fail";
    await (credentials as any)(); // plain call: memoizer starts its passive refresh
    let outcome: string;
    try {
      const c = await (credentials as any)({ forceRefresh: true });
      outcome = `resolved with ${c.accessKeyId}`;
    } catch (e) {
      outcome = "rejected";
    }
    record("R10e.forcedCallerOutcome", outcome);
    expect(outcome).toBe("rejected");
  });
});

describe("Informational (memoizer unit level)", () => {
  it("I7b memoizer: forceRefresh while a passive refresh is in flight: how many link calls?", async () => {
    let calls = 0;
    const link = async () => {
      calls++;
      await sleep(50);
      return { accessKeyId: `K${calls}`, secretAccessKey: "s", expiration: new Date(Date.now() + (calls === 1 ? 4 : 60) * MIN) };
    };
    const provider = memoizeChain([link as any], credentialsTreatedAsExpired);
    await provider();
    await provider(); // passive refresh starts
    await provider({ forceRefresh: true });
    await sleep(100);
    record("I7b.linkCallsAfterWarm", calls - 1);
  });
});
