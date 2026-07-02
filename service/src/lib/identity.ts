// Auth: turn a caller's credential into a VerifiedIdentity, then mint the
// short-lived scoped JWT the rest of the service already consumes.
//
//   dev   (AUTH_DRIVER=dev, non-prod only): caller posts { devSecret, sub, role }.
//                    The shared secret is required (no default) and checked
//                    server-side; the driver is disabled in production.
//   clerk (AUTH_DRIVER=clerk): caller posts { sessionToken }. Verified against
//                    Clerk's JWKS (RS256, issuer + optional audience); role comes
//                    from the token's claims.
// AUTH_DRIVER must be set explicitly — there is no silent default.
//
// The minted token is signed with JWT_SECRET and carries only { sub, role } with
// an expiry, so the existing `authenticate` middleware verifies it unchanged.

import jwt from "jsonwebtoken";
import { createPublicKey } from "node:crypto";
import { getConfig, IS_PRODUCTION_LIKE } from "../config.js";
import { fetchWithTimeout } from "./http.js";
import type { Role } from "./types.js";

const KNOWN_ROLES: Role[] = [
  "registration_clerk",
  "voter_contact_clerk",
  "list_data_clerk",
  "compliance_clerk",
  "events_clerk",
  "social_comms_clerk",
  "team_captain",
  "admin",
  "public",
];

function asRole(value: unknown): Role {
  return typeof value === "string" && (KNOWN_ROLES as string[]).includes(value)
    ? (value as Role)
    : "public";
}

export interface VerifiedIdentity {
  subject: string;
  role: Role;
  email?: string | null;
}

export interface IdentityVerifier {
  verify(cred: unknown): Promise<VerifiedIdentity | null>;
}

// --- dev verifier -----------------------------------------------------------

class DevVerifier implements IdentityVerifier {
  constructor(private devSecret: string) {}
  async verify(cred: unknown): Promise<VerifiedIdentity | null> {
    const c = (cred ?? {}) as {
      devSecret?: string;
      sub?: string;
      role?: string;
      email?: string;
    };
    if (!c.devSecret || c.devSecret !== this.devSecret) return null;
    if (!c.sub) return null;
    // Carry email through like the Clerk verifier, so team invite→bind works in dev too.
    return { subject: c.sub, role: asRole(c.role), email: c.email ?? null };
  }
}

// --- clerk verifier ---------------------------------------------------------

interface Jwk {
  kid: string;
  kty: string;
  [k: string]: unknown;
}

class ClerkVerifier implements IdentityVerifier {
  private jwks: Jwk[] | null = null;
  constructor(
    private jwksUrl: string,
    private issuer: string,
    private audience?: string
  ) {}

  private async loadJwks(): Promise<void> {
    const res = await fetchWithTimeout(this.jwksUrl);
    if (!res.ok) throw new Error("jwks_fetch_failed");
    const body = (await res.json()) as { keys: Jwk[] };
    this.jwks = body.keys;
  }

  private async keyFor(kid: string) {
    if (!this.jwks) await this.loadJwks();
    let jwk = this.jwks!.find((k) => k.kid === kid);
    if (!jwk) {
      // Unknown kid — Clerk may have rotated keys; refetch once before failing
      // (otherwise a rotation would break all logins until a restart).
      await this.loadJwks();
      jwk = this.jwks!.find((k) => k.kid === kid);
    }
    if (!jwk) throw new Error("jwks_kid_not_found");
    return createPublicKey({
      key: jwk,
      format: "jwk",
    } as unknown as Parameters<typeof createPublicKey>[0]);
  }

  async verify(cred: unknown): Promise<VerifiedIdentity | null> {
    const token = (cred as { sessionToken?: string })?.sessionToken;
    if (!token) return null;
    try {
      const decoded = jwt.decode(token, { complete: true });
      const kid = decoded?.header.kid;
      if (!kid) return null;
      const key = await this.keyFor(kid);
      const payload = jwt.verify(token, key, {
        issuer: this.issuer,
        algorithms: ["RS256"],
        ...(this.audience ? { audience: this.audience } : {}),
      }) as Record<string, unknown>;
      // Role lives in Clerk publicMetadata.role (mirror it into the session
      // token via a JWT template) or a top-level `role` claim.
      const meta = (payload.publicMetadata ?? {}) as { role?: string };
      const role = asRole(meta.role ?? payload.role);
      return {
        subject: String(payload.sub),
        role,
        email: (payload.email as string) ?? null,
      };
    } catch {
      return null;
    }
  }
}

let singleton: IdentityVerifier | null = null;

export async function getVerifier(): Promise<IdentityVerifier> {
  if (singleton) return singleton;
  // No silent default: the driver must be chosen explicitly so a missing/typo'd
  // AUTH_DRIVER can never quietly fall back to dev auth.
  const driver = process.env.AUTH_DRIVER;
  if (driver === "clerk") {
    const jwksUrl = await getConfig("CLERK_JWKS_URL");
    const issuer = await getConfig("CLERK_ISSUER");
    const audience = await getConfig("CLERK_AUDIENCE"); // optional; enforced when set
    if (jwksUrl && issuer) {
      singleton = new ClerkVerifier(jwksUrl, issuer, audience ?? undefined);
      return singleton;
    }
    throw new Error("clerk auth selected but CLERK_JWKS_URL/CLERK_ISSUER missing");
  }
  if (driver === "dev") {
    // dev driver must never run in a deployed (production-like) context, and
    // requires an explicit secret (no hardcoded fallback that could ship by
    // accident). Gated on IS_PRODUCTION_LIKE so an unset NODE_ENV on a real
    // deploy still refuses dev auth rather than failing open.
    if (IS_PRODUCTION_LIKE) {
      throw new Error("dev auth driver is disabled in production");
    }
    const devSecret = await getConfig("DEV_AUTH_SECRET");
    if (!devSecret) throw new Error("AUTH_DRIVER=dev requires DEV_AUTH_SECRET");
    singleton = new DevVerifier(devSecret);
    return singleton;
  }
  throw new Error("AUTH_DRIVER must be set to 'clerk' or 'dev'");
}

/** Test-only: drop the cached verifier so a test can switch drivers/config. */
export function resetVerifierForTests(): void {
  singleton = null;
}

export function mintScopedToken(
  identity: VerifiedIdentity,
  secret: string,
  ttlSeconds: number
): string {
  return jwt.sign({ sub: identity.subject, role: identity.role }, secret, {
    expiresIn: ttlSeconds,
  });
}

/**
 * Mint a short-lived step-up token for a sensitive action (e.g. SMS). It carries
 * `sa: true` and is required IN ADDITION to the normal scoped token, so a leaked
 * long-lived token cannot perform sensitive actions on its own.
 */
export function mintStepUpToken(
  identity: VerifiedIdentity,
  secret: string,
  ttlSeconds: number
): string {
  return jwt.sign(
    { sub: identity.subject, role: identity.role, sa: true },
    secret,
    { expiresIn: ttlSeconds }
  );
}

/** Verify a step-up token belongs to `subject` and is still valid. */
export function verifyStepUp(
  token: string | undefined,
  subject: string,
  secret: string
): boolean {
  if (!token) return false;
  try {
    const p = jwt.verify(token, secret, { algorithms: ["HS256"] }) as {
      sub?: string;
      sa?: boolean;
    };
    return p.sa === true && p.sub === subject;
  } catch {
    return false;
  }
}
