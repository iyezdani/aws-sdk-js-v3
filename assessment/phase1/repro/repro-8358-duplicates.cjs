// #8358: count STS refresh requests issued by getAuthToken() for near-expiry credentials.
//
// Sweeps the remaining lifetime of the cached credentials across the three regimes that
// matter at the pinned SHA:
//   > 15 min        : signer does no early refresh, memoizer does no passive refresh
//   5 min .. 15 min : signer forces a refresh; memoizer does not passive-refresh
//   < 5 min         : signer forces a refresh AND memoizer starts a passive refresh  -> duplicate
// For each regime it runs 1 call, 10 concurrent calls, and 5 sequential calls with STS failing.
// Counts exclude the initial cache fill. Uses the real fromNodeProviderChain web-identity path.
const { startFakeSts, applyEnv, signingKeyOf, resolvedPackages, sleep } = require("./lib/fake-sts.cjs");

const MIN = 60_000;

async function main() {
  const sts = await startFakeSts();
  applyEnv(sts.env);
  const { fromNodeProviderChain } = require("@aws-sdk/credential-providers");
  const { Signer } = require("@aws-sdk/rds-signer");
  console.log(JSON.stringify({ resolved: resolvedPackages(), node: process.version }));

  try {
    for (const remainingMin of [20, 10, 4]) {
      for (const scenario of [
        { name: "1 call", count: 1 },
        { name: "10 concurrent calls", count: 10, concurrent: true },
        { name: "5 sequential calls, STS failing", count: 5, fail: true },
      ]) {
        sts.state.mode = "ok";
        sts.state.lifetimeMs = remainingMin * MIN;
        const credentials = fromNodeProviderChain();
        const warm = await credentials();
        const m = sts.mark();
        sts.state.lifetimeMs = 60 * MIN;
        sts.state.mode = scenario.fail ? "fail" : "ok";

        const signer = new Signer({ hostname: "db.example.invalid", port: 5432, username: "user", region: "us-east-2", credentials });
        const signingKeys = [];
        let tokenErrors = 0;
        const one = () =>
          signer.getAuthToken().then(
            (t) => signingKeys.push(signingKeyOf(t)),
            () => tokenErrors++
          );
        if (scenario.concurrent) {
          await Promise.all(Array.from({ length: scenario.count }, one));
        } else {
          for (let i = 0; i < scenario.count; i++) {
            await one();
            await sleep(20);
          }
        }
        await sleep(50); // let any background (passive) refresh land
        console.log(
          JSON.stringify({
            remainingMin,
            scenario: scenario.name,
            stsRequests: sts.since(m),
            perCall: +(sts.since(m) / scenario.count).toFixed(2),
            tokenErrors,
            signedWith: [...new Set(signingKeys)].map((k) => (k === warm.accessKeyId ? `${k} (cached)` : `${k} (refreshed)`)),
          })
        );
      }
    }
  } finally {
    await sts.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
