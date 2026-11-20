const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");

async function main() {
  const mode = process.argv[2] || "hang";
  if (!["hang", "fail", "timeout-warn", "timeout-throw"].includes(mode)) {
    throw new Error("Use hang, fail, timeout-warn, or timeout-throw");
  }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("AWS_")) delete process.env[key];
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sts-repro-"));
  fs.writeFileSync(path.join(dir, "token"), "fake-web-identity-token");
  const sockets = new Set();
  const lifeMinutes = mode === "fail" ? 4 : 10;
  let refresh = false;
  let requests = 0;
  const events = [];
  const logger = Object.fromEntries(["trace", "debug", "info", "warn", "error"].map(
    (level) => [level, (...args) => events.push({ level, message: String(args[0]) })]
  ));
  const server = http.createServer((req, res) => {
    requests++;
    req.resume();
    if (refresh && mode !== "fail") return;
    if (refresh) {
      res.writeHead(503, { "content-type": "text/xml" });
      res.end("<ErrorResponse><Error><Code>ServiceUnavailable</Code><Message>synthetic outage</Message></Error></ErrorResponse>");
      return;
    }
    res.writeHead(200, { "content-type": "text/xml" });
    res.end(`<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleWithWebIdentityResult><Credentials><AccessKeyId>ASIAFAKELOCALONLY</AccessKeyId><SecretAccessKey>fake-secret</SecretAccessKey><SessionToken>fake-session</SessionToken><Expiration>${new Date(Date.now() + lifeMinutes * 60000).toISOString()}</Expiration></Credentials></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>`);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    Object.assign(process.env, {
      AWS_WEB_IDENTITY_TOKEN_FILE: path.join(dir, "token"),
      AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/local-test",
      AWS_REGION: "us-east-2",
      AWS_CONFIG_FILE: path.join(dir, "absent"),
      AWS_SHARED_CREDENTIALS_FILE: path.join(dir, "absent"),
      AWS_ENDPOINT_URL_STS: `http://127.0.0.1:${server.address().port}`,
      AWS_EC2_METADATA_DISABLED: "true",
      AWS_MAX_ATTEMPTS: "1",
    });
    const { fromNodeProviderChain } = require("@aws-sdk/credential-providers");
    const { Signer } = require("@aws-sdk/rds-signer");
    const options = { logger };
    if (mode.startsWith("timeout-")) {
      const { getDefaultRoleAssumerWithWebIdentity } = require("@aws-sdk/nested-clients/sts");
      options.roleAssumerWithWebIdentity = getDefaultRoleAssumerWithWebIdentity({
        region: "us-east-2", logger,
        requestHandler: {
          connectionTimeout: 100, requestTimeout: 100,
          throwOnRequestTimeout: mode === "timeout-throw",
        },
      });
    }
    const credentials = fromNodeProviderChain(options);
    const cached = await credentials();
    const warm = requests;
    refresh = true;
    events.length = 0;
    const signer = new Signer({
      hostname: "example.invalid", port: 5432, username: "user",
      region: "us-east-2", credentials,
    });
    const started = performance.now();
    let timer;
    const outcome = await Promise.race([
      signer.getAuthToken().then(() => "token issued", (error) => `rejected: ${error.message}`),
      new Promise((resolve) => { timer = setTimeout(() => resolve("still pending after 3000ms"), 3000); }),
    ]);
    clearTimeout(timer);
    await new Promise((resolve) => setTimeout(resolve, 50));
    console.log(JSON.stringify({
      mode, outcome, observedMs: Math.round(performance.now() - started),
      stsRequests: requests - warm,
      cachedCredentialsStillValid: cached.expiration.getTime() > Date.now(),
      warningsAndErrors: events.filter(({ level }) => level === "warn" || level === "error"),
    }));
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
