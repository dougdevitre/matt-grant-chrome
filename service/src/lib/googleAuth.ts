// Google service-account auth (2-legged JWT-bearer / "server-to-server" OAuth).
// Sign a short-lived assertion with the service-account private key, exchange it
// at Google's token endpoint for an access token, and cache it until just before
// expiry. This replaces the personal-bearer-token model in the Calendar/Gmail
// adapters: tokens auto-refresh and never expire silently.
//
// Creds load from SSM/env via getConfig — either a single GOOGLE_SA_JSON (the
// downloaded service-account key file) or GOOGLE_SA_CLIENT_EMAIL +
// GOOGLE_SA_PRIVATE_KEY. The private key is a SECRET (SSM SecureString).
// `subject` enables domain-wide delegation (impersonate the sending user).

import jwt from "jsonwebtoken";
import { getConfig } from "../config.js";
import { fetchWithTimeout } from "./http.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

export interface ServiceAccountCreds {
  clientEmail: string;
  privateKey: string;
}

/** PEM keys in env/SSM often arrive with literal "\n"; restore real newlines. */
function normalizeKey(key: string): string {
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}

/** Load SA creds from GOOGLE_SA_JSON or the client-email/private-key pair. */
export async function loadServiceAccount(): Promise<ServiceAccountCreds | null> {
  const json = await getConfig("GOOGLE_SA_JSON");
  if (json) {
    try {
      const parsed = JSON.parse(json) as { client_email?: string; private_key?: string };
      if (parsed.client_email && parsed.private_key) {
        return { clientEmail: parsed.client_email, privateKey: normalizeKey(parsed.private_key) };
      }
    } catch {
      // fall through to the discrete env vars
    }
  }
  const clientEmail = await getConfig("GOOGLE_SA_CLIENT_EMAIL");
  const privateKey = await getConfig("GOOGLE_SA_PRIVATE_KEY");
  if (clientEmail && privateKey) {
    return { clientEmail, privateKey: normalizeKey(privateKey) };
  }
  return null;
}

/** True if a service account is configured (used for wiring + the startup gate). */
export async function hasServiceAccount(): Promise<boolean> {
  return (await loadServiceAccount()) !== null;
}

export type GoogleTokenProvider = () => Promise<string>;

/**
 * Build a cached access-token provider for the given scopes (and optional
 * impersonated subject). The returned function fetches once, then serves the
 * cached token until ~60s before it expires, refreshing transparently.
 */
export function makeGoogleTokenProvider(
  scopes: string[],
  subject?: string
): GoogleTokenProvider {
  let cached: { token: string; expEpoch: number } | null = null;

  return async () => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    if (cached && cached.expEpoch - 60 > nowEpoch) return cached.token;

    const creds = await loadServiceAccount();
    if (!creds) throw new Error("google_sa_not_configured");

    const assertion = jwt.sign(
      {
        iss: creds.clientEmail,
        scope: scopes.join(" "),
        aud: TOKEN_URL,
        ...(subject ? { sub: subject } : {}),
      },
      creds.privateKey,
      { algorithm: "RS256", expiresIn: 3600 }
    );

    const res = await fetchWithTimeout(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }).toString(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`google_token_${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("google_token_no_access_token");

    cached = { token: json.access_token, expEpoch: nowEpoch + (json.expires_in ?? 3600) };
    return cached.token;
  };
}
