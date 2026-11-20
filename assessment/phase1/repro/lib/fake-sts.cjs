// Local fake STS (AssumeRoleWithWebIdentity) for reproducing aws-sdk-js-v3 #8358 / #8359.
// Loopback only, fake credentials, no AWS account. Each issued credential set is numbered
// (AccessKeyId ASIAFAKE0001, ASIAFAKE0002, ...) so a token can be traced to the exact
// credentials that signed it.
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");

const OK_XML = (n, expiration) =>
  `<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleWithWebIdentityResult><Credentials>` +
  `<AccessKeyId>${keyId(n)}</AccessKeyId><SecretAccessKey>fake-secret-${n}</SecretAccessKey>` +
  `<SessionToken>fake-session-${n}</SessionToken><Expiration>${expiration.toISOString()}</Expiration>` +
  `</Credentials></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>`;
const FAIL_XML =
  "<ErrorResponse><Error><Code>ServiceUnavailable</Code><Message>synthetic outage</Message></Error></ErrorResponse>";

const keyId = (n) => `ASIAFAKE${String(n).padStart(4, "0")}`;

/**
 * state.mode: "ok" | "stall" (accept, never respond) | "fail" (503)
 * state.delayMs: delay before responding in "ok"/"fail"
 * state.lifetimeMs: lifetime of issued credentials
 */
async function startFakeSts() {
  const state = { mode: "ok", delayMs: 5, lifetimeMs: 60 * 60_000 };
  const issued = new Map(); // accessKeyId -> expiration Date
  const requests = []; // { n, at, mode }
  const sockets = new Set();
  let issuedCount = 0;
  const t0 = Date.now();

  const server = http.createServer(async (req, res) => {
    req.resume();
    const mode = state.mode;
    requests.push({ at: Date.now() - t0, mode });
    if (mode === "stall") return; // accept the request, never answer
    await new Promise((r) => setTimeout(r, state.delayMs));
    if (mode === "fail") {
      res.writeHead(503, { "content-type": "text/xml" });
      res.end(FAIL_XML);
      return;
    }
    const n = ++issuedCount;
    const expiration = new Date(Date.now() + state.lifetimeMs);
    issued.set(keyId(n), expiration);
    res.writeHead(200, { "content-type": "text/xml" });
    res.end(OK_XML(n, expiration));
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rds-signer-repro-"));
  fs.writeFileSync(path.join(dir, "token"), "fake-web-identity-token");

  return {
    state,
    issued,
    requests,
    /** STS requests received since `mark` (a number returned by `mark()`). */
    mark: () => requests.length,
    since: (m) => requests.length - m,
    /** Destroy open sockets (e.g. the stalled one) without stopping the server. */
    destroySockets: () => {
      for (const s of sockets) s.destroy();
    },
    env: {
      AWS_WEB_IDENTITY_TOKEN_FILE: path.join(dir, "token"),
      AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/local-test",
      AWS_REGION: "us-east-2",
      AWS_CONFIG_FILE: path.join(dir, "absent"),
      AWS_SHARED_CREDENTIALS_FILE: path.join(dir, "absent"),
      AWS_ENDPOINT_URL_STS: `http://127.0.0.1:${server.address().port}`,
      AWS_EC2_METADATA_DISABLED: "true",
      AWS_MAX_ATTEMPTS: "1",
    },
    async close() {
      for (const s of sockets) s.destroy();
      if (server.listening) await new Promise((r) => server.close(r));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Clear AWS_* in this process only, then apply the fake-STS environment. */
function applyEnv(env) {
  for (const k of Object.keys(process.env)) if (k.startsWith("AWS_")) delete process.env[k];
  Object.assign(process.env, env);
}

/** Extract the access key id that signed an RDS auth token. */
function signingKeyOf(token) {
  const m = /X-Amz-Credential=([^%&]+)/.exec(token);
  return m ? m[1] : undefined;
}

/** Record which workspace build the packages resolve to, so results are tied to the pinned SHA. */
function resolvedPackages() {
  const out = {};
  for (const p of ["@aws-sdk/rds-signer", "@aws-sdk/credential-providers", "@aws-sdk/credential-provider-node"]) {
    try {
      const pkgJson = require.resolve(`${p}/package.json`);
      out[p] = { version: require(pkgJson).version, path: fs.realpathSync(path.dirname(pkgJson)) };
    } catch (e) {
      out[p] = `unresolved: ${e.message}`;
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Settle-state probe for a promise without awaiting it. */
function track(promise) {
  const t = { settled: false, value: undefined, error: undefined, at: undefined };
  const start = Date.now();
  promise.then(
    (v) => Object.assign(t, { settled: true, value: v, at: Date.now() - start }),
    (e) => Object.assign(t, { settled: true, error: e, at: Date.now() - start })
  );
  return t;
}

module.exports = { startFakeSts, applyEnv, signingKeyOf, resolvedPackages, sleep, track, keyId };
