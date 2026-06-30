// Auth: turn a caller's credential into a VerifiedIdentity, then mint the
// short-lived scoped JWT the rest of the service already consumes.
//
//   dev   (default): caller posts { devSecret, sub, role }. The shared secret is
//                    checked server-side; never works in production.
//   clerk (flag):    caller posts { sessionToken }. Verified against Clerk's
//                    JWKS (RS256); role comes from the token's claims.
//
// The minted token is signed with JWT_SECRET and carries only { sub, role } with
// an expiry, so the existing `authenticate` middleware verifies it unchanged.

import jwt from "jsonwebtoken";
import { createPublicKey } from "node:crypto";
import { getConfig, NODE_ENV } from "../config.js";
import type { Role } from "./types.js";

const KNOWN_ROLES: Role[] = [
  "registration_clerk",
  "voter_contact_clerk",
  "list_data_clerk",
  "compliance_clerk",
  "events_clerk",
  "social_comms_clerk",
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
    const c = (cred ?? {}) as { devSecret?: string; sub?: string; role?: string };
    if (!c.devSecret || c.devSecret !== this.devSecret) return null;
    if (!c.sub) return null;
    return { subject: c.sub, role: asRole(c.role) };
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
    private issuer: string
  ) {}

  private async loadJwks(): Promise<void> {
    const res = await fetch(this.jwksUrl);
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
  const driver = process.env.AUTH_DRIVER ?? "dev";
  if (driver === "clerk") {
    const jwksUrl = await getConfig("CLERK_JWKS_URL");
    const issuer = await getConfig("CLERK_ISSUER");
    if (jwksUrl && issuer) {
      singleton = new ClerkVerifier(jwksUrl, issuer);
      return singleton;
    }
    throw new Error("clerk auth selected but CLERK_JWKS_URL/CLERK_ISSUER missing");
  }
  // dev driver must never run in production.
  if (NODE_ENV === "production") {
    throw new Error("dev auth driver is disabled in production");
  }
  const devSecret = (await getConfig("DEV_AUTH_SECRET")) ?? "dev-only-change-me";
  singleton = new DevVerifier(devSecret);
  return singleton;
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
