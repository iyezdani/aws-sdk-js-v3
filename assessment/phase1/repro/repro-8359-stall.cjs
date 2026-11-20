// #8359: getAuthToken() blocks on a stalled early refresh even though cached credentials are valid.
//
// Phase A  cached creds have 10 min left (signer's 15-min window, outside memoizer's 5-min window);
//          STS accepts the refresh request and never answers.    -> call A stays pending.
//          Meanwhile a plain (non-forced) provider call returns valid cached creds immediately.
// Phase B  STS recovers. A new call B is made.                     -> B ALSO stays pending, without
//          sending any STS request: it joins the memoizer's stalled forceRefreshLock.
// Phase C  The stalled socket is destroyed (transport error).      -> only now do A and B resolve,
//          falling back to the cached credentials.
// Phase D  Same stall with 4 min left (inside the memoizer's passive window): both the passive and
//          the forced refresh stall.
const { startFakeSts, applyEnv, signingKeyOf, resolvedPackages, sleep, track } = require("./lib/fake-sts.cjs");

const MIN = 60_000;
const OBSERVE_MS = 3000;

const describe = (t) =>
  !t.settled ? "pending" : t.error ? `rejected after ${t.at}ms: ${t.error.message}` : `resolved after ${t.at}ms`;

async function main() {
  const sts = await startFakeSts();
  applyEnv(sts.env);
  const { fromNodeProviderChain } = require("@aws-sdk/credential-providers");
  const { Signer } = require("@aws-sdk/rds-signer");
  const log = (o) => console.log(JSON.stringify(o));
  log({ resolved: resolvedPackages(), node: process.version });
  const mkSigner = (credentials) =>
    new Signer({ hostname: "db.example.invalid", port: 5432, username: "user", region: "us-east-2", credentials });

  try {
    // ---------------- Phase A
    sts.state.mode = "ok";
    sts.state.lifetimeMs = 10 * MIN;
    const credentials = fromNodeProviderChain();
    const cached = await credentials();
    const m = sts.mark();
    sts.state.mode = "stall";
    const signer = mkSigner(credentials);

    const a = track(signer.getAuthToken());
    await sleep(OBSERVE_MS);
    const t0 = performance.now();
    const plain = await credentials();
    const plainMs = Math.round(performance.now() - t0);
    log({
      phase: "A: 10 min left, STS stalls",
      callA: describe(a),
      stsRequests: sts.since(m),
      cachedValidForMin: +((cached.expiration - Date.now()) / MIN).toFixed(1),
      plainProviderCall: `returned ${plain.accessKeyId} in ${plainMs}ms (same as cached: ${plain.accessKeyId === cached.accessKeyId})`,
    });

    // ---------------- Phase B
    sts.state.mode = "ok";
    const b = track(signer.getAuthToken());
    await sleep(OBSERVE_MS);
    log({
      phase: "B: STS healthy again, new call",
      callA: describe(a),
      callB: describe(b),
      stsRequests: sts.since(m),
      note: "callB sent no STS request; it is awaiting the stalled forceRefreshLock",
    });

    // ---------------- Phase C
    const destroyedAt = Date.now();
    sts.destroySockets();
    await sleep(500);
    const [ta, tb] = await Promise.all([a, b].map(async (t) => t));
    log({
      phase: "C: stalled socket destroyed",
      callA: describe(a),
      callB: describe(b),
      resolvedWithinMsOfDestroy: Date.now() - destroyedAt,
      signedWith: [a, b].map((t) => (t.value ? signingKeyOf(t.value) : null)),
      cachedKey: cached.accessKeyId,
    });

    // ---------------- Phase D
    sts.state.mode = "ok";
    sts.state.lifetimeMs = 4 * MIN;
    const credentials2 = fromNodeProviderChain();
    await credentials2();
    const m2 = sts.mark();
    sts.state.mode = "stall";
    const d = track(mkSigner(credentials2).getAuthToken());
    await sleep(OBSERVE_MS);
    log({
      phase: "D: 4 min left, STS stalls",
      call: describe(d),
      stsRequests: sts.since(m2),
      note: "passive (memoizer) + forced (signer) refresh both stalled",
    });
  } finally {
    await sts.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
