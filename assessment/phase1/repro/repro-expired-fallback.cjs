// Latent defect next to #8359 ("recheck credential expiration before fallback").
//
// The signer's wrapper captures the cached credentials *before* awaiting the forced refresh and
// returns that captured object if the refresh fails. If the refresh takes longer than the
// credentials' remaining lifetime and then fails, getAuthToken() resolves successfully with a
// token signed by credentials that are already expired: no error, dead-on-arrival token.
//
// Case 1  real chain: cached creds expire in 3 s; STS answers 503 after 4 s.
// Case 2  custom (non-memoized) provider that returns already-expired creds and whose forced
//         refresh fails: the signer signs with the already-expired creds.
const { startFakeSts, applyEnv, signingKeyOf, resolvedPackages, sleep } = require("./lib/fake-sts.cjs");

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
    // ---------------- Case 1
    sts.state.mode = "ok";
    sts.state.lifetimeMs = 3000;
    const credentials = fromNodeProviderChain();
    const cached = await credentials();
    const m = sts.mark();
    sts.state.mode = "fail";
    sts.state.delayMs = 4000;

    const started = Date.now();
    let outcome;
    try {
      const token = await mkSigner(credentials).getAuthToken();
      const key = signingKeyOf(token);
      const exp = sts.issued.get(key);
      outcome = {
        result: "token issued (no error)",
        signedWith: key,
        signingCredsExpiredMsBeforeTokenReturned: Date.now() - exp.getTime(),
      };
    } catch (e) {
      outcome = { result: `rejected: ${e.message}` };
    }
    log({
      case: "1: chain, creds expire in 3s, STS fails after 4s",
      ...outcome,
      tookMs: Date.now() - started,
      stsRequests: sts.since(m),
      cachedKey: cached.accessKeyId,
    });

    // ---------------- Case 2
    const expired = {
      accessKeyId: "ASIAEXPIRED",
      secretAccessKey: "s",
      sessionToken: "t",
      expiration: new Date(Date.now() - 60_000),
    };
    const calls = [];
    const custom = async (props) => {
      calls.push(props?.forceRefresh ? "forceRefresh" : "plain");
      if (props?.forceRefresh) throw new Error("refresh failed");
      return expired;
    };
    let outcome2;
    try {
      const token = await mkSigner(custom).getAuthToken();
      outcome2 = { result: "token issued (no error)", signedWith: signingKeyOf(token) };
    } catch (e) {
      outcome2 = { result: `rejected: ${e.message}` };
    }
    log({ case: "2: custom provider returns already-expired creds, refresh fails", ...outcome2, providerCalls: calls });
  } finally {
    sts.state.delayMs = 5;
    await sleep(10);
    await sts.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
