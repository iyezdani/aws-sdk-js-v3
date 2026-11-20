// Shared helpers for the evaluation harness. Black-box by design: tests drive the real Signer
// (real SigV4 presigning) and the real memoizeChain, and identify the credentials that signed a
// token from its X-Amz-Credential. No option names, deadlines or internals of any fix are assumed.
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from "@smithy/types";
import { vi } from "vitest";

import { credentialsTreatedAsExpired } from "../../packages-internal/credential-provider-node/src/defaultProvider";
import { memoizeChain } from "../../packages-internal/credential-provider-node/src/runtime/memoize-chain";
import { Signer } from "../../packages/rds-signer/src/Signer";

export const MIN = 60_000;
/** Rubric R1/R2/R9: fallback to valid cached credentials must happen within this much (simulated) time. */
export const BOUND_MS = 30_000;
/** Rubric R3: a refresh that completes after this long must still be the one used. */
export const HEALTHY_LATENCY_MS = 500;
/** Resolution of simulated-time stepping, and therefore of the measured fallback latency (I1). */
export const STEP_MS = 100;
export const T0 = new Date("2026-06-01T12:00:00.000Z");

export type Creds = AwsCredentialIdentity;

/** Every credential set the harness hands out, by access key id, for expiry checks on tokens. */
export const issued = new Map<string, Creds>();

export const creds = (accessKeyId: string, msLeft?: number): Creds => {
  const c: Creds = {
    accessKeyId,
    secretAccessKey: `secret-${accessKeyId}`,
    sessionToken: `session-${accessKeyId}`,
    ...(msLeft === undefined ? {} : { expiration: new Date(Date.now() + msLeft) }),
  };
  issued.set(accessKeyId, c);
  return c;
};

let freshSeq = 0;
/** New credentials valid for 60 minutes: FRESH1, FRESH2, ... */
export const fresh = () => creds(`FRESH${++freshSeq}`, 60 * MIN);

// ---------------------------------------------------------------------------------------------
// Refresh behaviours: what the underlying credential source does when asked for new credentials.
// ---------------------------------------------------------------------------------------------
export type Refresh = () => Promise<Creds>;

/** STS accepted the request and never answered. */
export const stall: Refresh = () => new Promise<Creds>(() => {});
export const resolveAfter =
  (ms: number, make: () => Creds = fresh): Refresh =>
  () =>
    new Promise((resolve) => setTimeout(() => resolve(make()), ms));
export const rejectAfter =
  (ms: number, message = "synthetic refresh failure"): Refresh =>
  () =>
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
export const rejectNow =
  (message = "synthetic refresh failure"): Refresh =>
  () =>
    Promise.reject(new Error(message));

/** Steps are used in order; the last one repeats. */
export const sequence = (...steps: Refresh[]): Refresh => {
  let i = 0;
  return () => steps[Math.min(i++, steps.length - 1)]();
};

/** A refresh the test settles by hand. `handedOut` guards against blaming an output for a promise it never received. */
export function controlled() {
  let resolve!: (c: Creds) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<Creds>((a, b) => {
    resolve = a;
    reject = b;
  });
  const ctl = {
    handedOut: false,
    refresh: (() => {
      ctl.handedOut = true;
      return promise;
    }) as Refresh,
    resolve,
    /** Rejects only if some caller actually received the promise. */
    reject: (e: unknown) => {
      if (ctl.handedOut) reject(e);
    },
  };
  return ctl;
}

// ---------------------------------------------------------------------------------------------
// Credential providers as the Signer sees them.
// ---------------------------------------------------------------------------------------------

/**
 * A non-memoized provider (a custom function, as users may pass). Plain calls always return the
 * same cached credentials; calls with forceRefresh run `force`. Keyed on the flag, not on call
 * order, so a fix that re-reads the provider at fallback is handled correctly.
 */
export function plainProvider(cached: Creds, force: Refresh) {
  const calls = { plain: 0, force: 0 };
  const fn: AwsCredentialIdentityProvider = async (props?: Record<string, any>) => {
    if (props?.forceRefresh) {
      calls.force++;
      return force();
    }
    calls.plain++;
    return cached;
  };
  return { fn, calls };
}

/**
 * The real memoizer used by the default Node chain (defaultProvider = memoizeChain(links,
 * credentialsTreatedAsExpired)), over one scripted link. The first link call (warm-up) returns
 * `initial`; every later call is a refresh and runs `refresh`.
 */
export function chainProvider(initial: Creds, refresh: Refresh) {
  let n = 0;
  const refreshes = { count: 0, forced: 0 };
  const link = async (options?: Record<string, any>) => {
    if (n++ === 0) return initial;
    refreshes.count++;
    if (options?.forceRefresh) refreshes.forced++;
    return refresh();
  };
  const fn = memoizeChain([link as any], credentialsTreatedAsExpired) as unknown as AwsCredentialIdentityProvider;
  return {
    fn,
    refreshes,
    warm: async () => {
      await (fn as any)();
    },
  };
}

export const signerFor = (credentials: Creds | AwsCredentialIdentityProvider) =>
  new Signer({ hostname: "db.example.com", port: 5432, username: "iam_user", region: "us-east-1", credentials });

/** Access key id of the credentials that signed an RDS auth token. */
export const signingKey = (token: string | undefined) =>
  token ? /X-Amz-Credential=([^%&]+)/.exec(token)?.[1] : undefined;

// ---------------------------------------------------------------------------------------------
// Observation and time.
// ---------------------------------------------------------------------------------------------
export interface Tracked<T> {
  settled: boolean;
  ok?: boolean;
  value?: T;
  error?: unknown;
  /** Simulated (or real) ms between start and settlement. */
  elapsedMs?: number;
  /** Date.now() at settlement. */
  settledAt?: number;
}

export function track<T>(p: Promise<T>): Tracked<T> {
  const start = Date.now();
  const t: Tracked<T> = { settled: false };
  p.then(
    (value) => Object.assign(t, { settled: true, ok: true, value, elapsedMs: Date.now() - start, settledAt: Date.now() }),
    (error) => Object.assign(t, { settled: true, ok: false, error, elapsedMs: Date.now() - start, settledAt: Date.now() })
  );
  return t;
}

export async function flush() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

export async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
}

/** Advance simulated time in STEP_MS increments until `done()` or `maxMs`. Returns ms advanced. */
export async function advanceUntil(done: () => boolean, maxMs = BOUND_MS) {
  await flush();
  let waited = 0;
  while (!done() && waited < maxMs) {
    await advance(STEP_MS);
    waited += STEP_MS;
  }
  return waited;
}

/** True if `t` resolved with a token signed by credentials that were expired when it was returned. */
export function signedWithExpired(t: Tracked<string>): boolean {
  if (!t.settled || !t.ok) return false;
  const c = issued.get(signingKey(t.value) ?? "");
  return !!c?.expiration && c.expiration.getTime() <= (t.settledAt as number);
}

export const describeOutcome = (t: Tracked<string>) =>
  !t.settled
    ? "pending"
    : t.ok
      ? `token signed with ${signingKey(t.value)} after ${t.elapsedMs}ms`
      : `rejected after ${t.elapsedMs}ms: ${(t.error as Error)?.message}`;

export function captureUnhandled() {
  const list: unknown[] = [];
  const handler = (reason: unknown) => list.push(reason);
  process.on("unhandledRejection", handler);
  return { list, stop: () => process.off("unhandledRejection", handler) };
}

/** Leave fake time and give Node a real turn, so pending unhandled-rejection events are dispatched. */
export async function realTurn(ms = 25) {
  vi.useRealTimers();
  await new Promise((r) => setTimeout(r, ms));
  await new Promise((r) => setImmediate(r));
}

/** Number of live, ref'd timers (unref'd timers are not reported by Node). */
export const liveTimers = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
