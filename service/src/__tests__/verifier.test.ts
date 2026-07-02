// Auth driver selection must be explicit (no silent dev fallback) and require a
// secret; the Clerk verifier checks issuer + audience (RS256 against the JWKS).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, createPublicKey } from "node:crypto";
import jwt from "jsonwebtoken";
import { getVerifier, resetVerifierForTests } from "../lib/identity.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const KID = "test-kid";
const ISSUER = "https://clerk.test";
const AUDIENCE = "mg-api";

const ENV = [
  "AUTH_DRIVER",
  "DEV_AUTH_SECRET",
  "NODE_ENV",
  "CLERK_JWKS_URL",
  "CLERK_ISSUER",
  "CLERK_AUDIENCE",
] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV) saved[k] = process.env[k];
  for (const k of ENV) delete process.env[k];
  resetVerifierForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetVerifierForTests();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getVerifier driver selection", () => {
  it("rejects when AUTH_DRIVER is unset (no silent dev fallback)", async () => {
    await expect(getVerifier()).rejects.toThrow(/AUTH_DRIVER/);
  });

  it("rejects AUTH_DRIVER=dev without DEV_AUTH_SECRET", async () => {
    process.env.AUTH_DRIVER = "dev";
    await expect(getVerifier()).rejects.toThrow(/DEV_AUTH_SECRET/);
  });

  it("accepts AUTH_DRIVER=dev with a secret (non-prod) and checks it", async () => {
    process.env.NODE_ENV = "development"; // dev auth is only allowed in relaxed local mode
    process.env.AUTH_DRIVER = "dev";
    process.env.DEV_AUTH_SECRET = "s3cret";
    const v = await getVerifier();
    expect(await v.verify({ devSecret: "s3cret", sub: "u1", role: "admin" })).toMatchObject({
      subject: "u1",
      role: "admin",
    });
    expect(await v.verify({ devSecret: "wrong", sub: "u1" })).toBeNull();
  });

  it("refuses AUTH_DRIVER=dev when NODE_ENV is unset (fails safe as production-like)", async () => {
    // A deploy that forgets NODE_ENV=production must not fall back to dev auth,
    // which would let a caller mint an admin token with the shared dev secret.
    // IS_PRODUCTION_LIKE is captured at config load, so re-import a fresh module
    // graph with NODE_ENV unset to exercise the production-like branch.
    delete process.env.NODE_ENV;
    process.env.AUTH_DRIVER = "dev";
    process.env.DEV_AUTH_SECRET = "s3cret";
    vi.resetModules();
    const { getVerifier: freshGetVerifier } = await import("../lib/identity.js");
    await expect(freshGetVerifier()).rejects.toThrow(/disabled in production/);
  });
});

describe("ClerkVerifier", () => {
  function stubJwks() {
    const jwk = { ...createPublicKey(publicKey).export({ format: "jwk" }), kid: KID, kty: "RSA" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ keys: [jwk] }) }))
    );
  }
  function clerkEnv() {
    process.env.AUTH_DRIVER = "clerk";
    process.env.CLERK_JWKS_URL = "https://clerk.test/jwks";
    process.env.CLERK_ISSUER = ISSUER;
    process.env.CLERK_AUDIENCE = AUDIENCE;
  }
  function token(aud: string) {
    return jwt.sign({ publicMetadata: { role: "admin" }, email: "a@b.co" }, privateKey, {
      algorithm: "RS256",
      keyid: KID,
      issuer: ISSUER,
      audience: aud,
      subject: "clerk-user-1",
    });
  }

  it("verifies a token with the right issuer + audience and reads the role", async () => {
    clerkEnv();
    stubJwks();
    const v = await getVerifier();
    const identity = await v.verify({ sessionToken: token(AUDIENCE) });
    expect(identity).toMatchObject({ subject: "clerk-user-1", role: "admin", email: "a@b.co" });
  });

  it("rejects a token with the wrong audience", async () => {
    clerkEnv();
    stubJwks();
    const v = await getVerifier();
    expect(await v.verify({ sessionToken: token("some-other-aud") })).toBeNull();
  });
});
