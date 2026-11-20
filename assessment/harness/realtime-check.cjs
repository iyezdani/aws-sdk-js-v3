// Layer 3: real-time checks of the timing rows against the *built* packages (dist), through the
// real default credential chain, STS client and HTTP, against a loopback fake STS.
// Unlike the Phase 1 repro scripts (3 s observation windows), each case waits up to the rubric's
// 30 s bound, so it can pass or fail any reasonable deadline. Also the fallback for scoring policy 2
// (implementations whose timers are not driven by Vitest fake timers).
//   NODE_PATH=D:/ToptalAssessment/aws-sdk-js-v3/node_modules node assessment/harness/realtime-check.cjs
const path = require("node:path");
const { startFakeSts, applyEnv, signingKeyOf, resolvedPackages, sleep, track } = require(
  path.join(__dirname, "..", "phase1", "repro", "lib", "fake-sts.cjs")
);

const MIN = 60_000;
const BOUND_MS = 30_000;

async function settleWithin(trackers, ms) {
  const start = Date.now();
  while (!trackers.every((t) => t.settled) && Date.now() - start < ms) await sleep(25);
}
const outcome = (t, issued) => {
  if (!t.settled) return { state: "pending" };
  if (t.error) return { state: "rejected", ms: t.at, error: t.error.message };
  const key = signingKeyOf(t.value);
  const exp = issued.get(key);
  return { state: "token", ms: t.at, key, expiredAtReturn: !!exp && exp.getTime() <= t.startedAt + t.at };
};

async function main() {
  const sts = await startFakeSts();
  applyEnv(sts.env);
  const { fromNodeProviderChain } = require("@aws-sdk/credential-providers");
  const { Signer } = require("@aws-sdk/rds-signer");
  const log = (o) => console.log(JSON.stringify(o));
  log({ resolved: resolvedPackages(), node: process.version });
  const mkSigner = (credentials) =>
    new Signer({ hostname: "db.example.invalid", port: 5432, username: "user", region: "us-east-2", credentials });
  const warm = async (lifetimeMs) => {
    sts.state.mode = "ok";
    sts.state.delayMs = 5;
    sts.state.lifetimeMs = lifetimeMs;
    const credentials = fromNodeProviderChain();
    const cached = await credentials();
    sts.state.lifetimeMs = 60 * MIN;
    return { credentials, cachedKey: cached.accessKeyId };
  };

  try {
    // RT-R1: 10 min left, STS stalls.
    {
      const { credentials, cachedKey } = await warm(10 * MIN);
      sts.state.mode = "stall";
      const t = Object.assign(track(mkSigner(credentials).getAuthToken()), { startedAt: Date.now() });
      await settleWithin([t], BOUND_MS + 2000);
      const o = outcome(t, sts.issued);
      log({ row: "R1", case: "10 min left, STS stalls", ...o, pass: o.state === "token" && o.key === cachedKey && o.ms <= BOUND_MS });
      sts.destroySockets();
    }
    // RT-R2: 4 min left, STS stalls (passive + forced).
    {
      const { credentials, cachedKey } = await warm(4 * MIN);
      sts.state.mode = "stall";
      const t = Object.assign(track(mkSigner(credentials).getAuthToken()), { startedAt: Date.now() });
      await settleWithin([t], BOUND_MS + 2000);
      const o = outcome(t, sts.issued);
      log({ row: "R2", case: "4 min left, STS stalls", ...o, pass: o.state === "token" && o.key === cachedKey && o.ms <= BOUND_MS });
      sts.destroySockets();
    }
    // RT-R3: 10 min left, STS healthy but slow (500 ms).
    {
      const { credentials, cachedKey } = await warm(10 * MIN);
      sts.state.delayMs = 500;
      const t = Object.assign(track(mkSigner(credentials).getAuthToken()), { startedAt: Date.now() });
      await settleWithin([t], BOUND_MS + 2000);
      const o = outcome(t, sts.issued);
      log({ row: "R3", case: "10 min left, STS answers after 500 ms", ...o, pass: o.state === "token" && o.key !== cachedKey });
    }
    // RT-R4: cached credentials expire in 3 s, STS fails after 4 s.
    {
      const { credentials } = await warm(3_000);
      sts.state.mode = "fail";
      sts.state.delayMs = 4_000;
      const t = Object.assign(track(mkSigner(credentials).getAuthToken()), { startedAt: Date.now() });
      await settleWithin([t], BOUND_MS + 2000);
      const o = outcome(t, sts.issued);
      log({ row: "R4", case: "3 s left, STS fails after 4 s", ...o, pass: !(o.state === "token" && o.expiredAtReturn) });
      sts.state.delayMs = 5;
    }
    // RT-R9: 10 concurrent calls, 10 min left, STS stalls.
    {
      const { credentials, cachedKey } = await warm(10 * MIN);
      sts.state.mode = "stall";
      const signer = mkSigner(credentials);
      const ts = Array.from({ length: 10 }, () => Object.assign(track(signer.getAuthToken()), { startedAt: Date.now() }));
      await settleWithin(ts, BOUND_MS + 2000);
      const os = ts.map((t) => outcome(t, sts.issued));
      const pass = os.every((o) => o.state === "token" && o.key === cachedKey && o.ms <= BOUND_MS);
      log({ row: "R9", case: "10 concurrent, 10 min left, STS stalls", states: os.map((o) => `${o.state}@${o.ms ?? "-"}`), pass });
      sts.destroySockets();
    }
  } finally {
    await sts.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
