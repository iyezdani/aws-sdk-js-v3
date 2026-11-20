const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");

async function main() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("AWS_")) delete process.env[key];
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sts-repro-"));
  fs.writeFileSync(path.join(dir, "token"), "fake-web-identity-token");
  const sockets = new Set();
  let requests = 0;
  let lifeMinutes = 4;
  let fail = false;
  const server = http.createServer(async (req, res) => {
    requests++;
    req.resume();
    await delay(5);
    if (fail) {
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
    for (const scenario of [
      { name: "one token request", count: 1 },
      { name: "ten concurrent token requests", count: 10, concurrent: true },
      { name: "five sequential token requests, STS failing", count: 5, fail: true },
    ]) {
      fail = false;
      lifeMinutes = 4;
      const credentials = fromNodeProviderChain();
      await credentials();
      const warm = requests;
      lifeMinutes = 60;
      fail = Boolean(scenario.fail);
      const signer = new Signer({
        hostname: "example.invalid", port: 5432, username: "user",
        region: "us-east-2", credentials,
      });
      let tokenErrors = 0;
      const one = () => signer.getAuthToken().catch(() => { tokenErrors++; });
      if (scenario.concurrent) {
        await Promise.all(Array.from({ length: scenario.count }, one));
      } else {
        for (let i = 0; i < scenario.count; i++) {
          await one();
          await delay(20);
        }
      }
      await delay(50);
      console.log(JSON.stringify({ scenario: scenario.name, stsRequests: requests - warm, tokenErrors }));
    }
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
