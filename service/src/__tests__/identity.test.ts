// Step-up tokens gate sensitive (SMS) actions. A step-up token must carry
// sa:true, match the subject, and still be unexpired. A normal scoped token
// must NOT satisfy a step-up check.

import { mintScopedToken, mintStepUpToken, verifyStepUp } from "../lib/identity.js";
import type { VerifiedIdentity } from "../lib/identity.js";

const SECRET = "test-secret";
const admin: VerifiedIdentity = { subject: "clerk-1", role: "admin" };

describe("verifyStepUp", () => {
  it("accepts a fresh step-up token for the same subject", () => {
    const token = mintStepUpToken(admin, SECRET, 300);
    expect(verifyStepUp(token, "clerk-1", SECRET)).toBe(true);
  });

  it("rejects a token minted for a different subject", () => {
    const token = mintStepUpToken(admin, SECRET, 300);
    expect(verifyStepUp(token, "someone-else", SECRET)).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const token = mintStepUpToken(admin, SECRET, 300);
    expect(verifyStepUp(token, "clerk-1", "wrong-secret")).toBe(false);
  });

  it("rejects an expired token", () => {
    const token = mintStepUpToken(admin, SECRET, -10); // already expired
    expect(verifyStepUp(token, "clerk-1", SECRET)).toBe(false);
  });

  it("rejects a normal scoped token (no sa:true claim)", () => {
    const scoped = mintScopedToken(admin, SECRET, 300);
    expect(verifyStepUp(scoped, "clerk-1", SECRET)).toBe(false);
  });

  it("rejects a missing token", () => {
    expect(verifyStepUp(undefined, "clerk-1", SECRET)).toBe(false);
  });
});
