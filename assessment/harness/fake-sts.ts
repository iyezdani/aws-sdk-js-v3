// Loopback fake STS (AssumeRoleWithWebIdentity) for the end-to-end rows. Fake credentials only.
// Each issued credential set is numbered (ASIAFAKE0001, ...) so tokens can be traced.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const keyId = (n: number) => `ASIAFAKE${String(n).padStart(4, "0")}`;

export interface FakeSts {
  state: { mode: "ok" | "fail" | "stall"; delayMs: number; lifetimeMs: number };
  requests: () => number;
  issued: Map<string, Date>;
  env: Record<string, string>;
  close: () => Promise<void>;
}

export async function startFakeSts(): Promise<FakeSts> {
  const state: FakeSts["state"] = { mode: "ok", delayMs: 5, lifetimeMs: 60 * 60_000 };
  const issued = new Map<string, Date>();
  const sockets = new Set<Socket>();
  let requests = 0;
  let n = 0;
  const server: Server = createServer(async (req, res) => {
    requests++;
    req.resume();
    const mode = state.mode;
    if (mode === "stall") return;
    await new Promise((r) => setTimeout(r, state.delayMs));
    if (mode === "fail") {
      res.writeHead(503, { "content-type": "text/xml" });
      res.end("<ErrorResponse><Error><Code>ServiceUnavailable</Code><Message>synthetic outage</Message></Error></ErrorResponse>");
      return;
    }
    const id = keyId(++n);
    const expiration = new Date(Date.now() + state.lifetimeMs);
    issued.set(id, expiration);
    res.writeHead(200, { "content-type": "text/xml" });
    res.end(
      `<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleWithWebIdentityResult><Credentials>` +
        `<AccessKeyId>${id}</AccessKeyId><SecretAccessKey>fake-secret</SecretAccessKey><SessionToken>fake-session-${n}</SessionToken>` +
        `<Expiration>${expiration.toISOString()}</Expiration></Credentials></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>`
    );
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const dir = mkdtempSync(join(tmpdir(), "rds-signer-harness-"));
  writeFileSync(join(dir, "token"), "fake-web-identity-token");
  return {
    state,
    requests: () => requests,
    issued,
    env: {
      AWS_WEB_IDENTITY_TOKEN_FILE: join(dir, "token"),
      AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/local-test",
      AWS_REGION: "us-east-2",
      AWS_CONFIG_FILE: join(dir, "absent"),
      AWS_SHARED_CREDENTIALS_FILE: join(dir, "absent"),
      AWS_ENDPOINT_URL_STS: `http://127.0.0.1:${port}`,
      AWS_EC2_METADATA_DISABLED: "true",
      AWS_MAX_ATTEMPTS: "1",
    },
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
