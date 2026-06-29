// Shared helpers for integration tests. We mint the scoped/step-up JWTs directly
// (the authenticate middleware only verifies signature + reads role), which keeps
// tests off the rate-limited /auth/token path. The signing secret must match what
// the app reads from process.env.JWT_SECRET — set TEST_JWT_SECRET there in setup.

import jwt from "jsonwebtoken";
import type { Role } from "../lib/types.js";

export const TEST_JWT_SECRET = "integration-test-secret";

// Long TTL so a token minted under one faked system date is still valid when a
// test advances the clock across a phase boundary.
export function tokenFor(role: Role, sub = "clerk-1"): string {
  return jwt.sign({ sub, role }, TEST_JWT_SECRET, { expiresIn: "60d" });
}

export function stepUpToken(sub = "clerk-1", role: Role = "admin"): string {
  return jwt.sign({ sub, role, sa: true }, TEST_JWT_SECRET, { expiresIn: "1d" });
}

export function bearer(token: string): string {
  return `Bearer ${token}`;
}
