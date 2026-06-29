// Google service-account token provider. Uses an in-test RSA keypair so we can
// verify the signed assertion the way Google's token endpoint would, then checks
// caching and refresh. Fetch is stubbed — no network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { hasServiceAccount, makeGoogleTokenProvider } from "../lib/googleAuth.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function tokenResponse(accessToken: string, expiresIn = 3600) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ access_token: accessToken, expires_in: expiresIn }),
    text: async () => "",
  };
}

beforeEach(() => {
  process.env.GOOGLE_SA_CLIENT_EMAIL = "svc@proj.iam.gserviceaccount.com";
  process.env.GOOGLE_SA_PRIVATE_KEY = privateKey;
  delete process.env.GOOGLE_SA_JSON;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.GOOGLE_SA_CLIENT_EMAIL;
  delete process.env.GOOGLE_SA_PRIVATE_KEY;
});

describe("makeGoogleTokenProvider", () => {
  it("signs a valid RS256 assertion with the right claims and returns the token", async () => {
    let assertion: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        assertion = new URLSearchParams(init.body).get("assertion");
        return tokenResponse("at-1");
      })
    );

    const provider = makeGoogleTokenProvider(["scopeA", "scopeB"], "user@grant.org");
    expect(await provider()).toBe("at-1");

    const payload = jwt.verify(assertion!, publicKey, { algorithms: ["RS256"] }) as Record<string, unknown>;
    expect(payload.iss).toBe("svc@proj.iam.gserviceaccount.com");
    expect(payload.scope).toBe("scopeA scopeB");
    expect(payload.aud).toBe("https://oauth2.googleapis.com/token");
    expect(payload.sub).toBe("user@grant.org");
  });

  it("caches the token across calls (one token fetch)", async () => {
    const fetchMock = vi.fn(async () => tokenResponse("at"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = makeGoogleTokenProvider(["s"]);
    await provider();
    await provider();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes once the cached token nears expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    let n = 0;
    const fetchMock = vi.fn(async () => tokenResponse(`at-${++n}`, 3600));
    vi.stubGlobal("fetch", fetchMock);

    const provider = makeGoogleTokenProvider(["s"]);
    expect(await provider()).toBe("at-1");
    vi.setSystemTime(new Date("2026-07-01T02:00:00Z")); // 2h later — past expiry
    expect(await provider()).toBe("at-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces the token-endpoint error body", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => '{"error":"invalid_grant"}',
    }));
    const provider = makeGoogleTokenProvider(["s"]);
    await expect(provider()).rejects.toThrow(/google_token_401.*invalid_grant/);
  });
});

describe("hasServiceAccount", () => {
  it("is true with creds and false without", async () => {
    expect(await hasServiceAccount()).toBe(true);
    delete process.env.GOOGLE_SA_CLIENT_EMAIL;
    expect(await hasServiceAccount()).toBe(false);
  });
});
