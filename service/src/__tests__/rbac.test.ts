// RBAC: scopes are derived server-side from role. These guard which clerk can
// do what; the SMS scope in particular must be admin-only.

import { scopesForRole, hasScope, ALL_SCOPES, ROLE_SCOPES } from "../rbac.js";
import type { Role } from "../lib/types.js";

describe("scopesForRole", () => {
  it("gives admin every scope (including sms.send)", () => {
    expect(scopesForRole("admin")).toEqual(ALL_SCOPES);
    expect(hasScope(scopesForRole("admin"), "sms.send")).toBe(true);
  });

  it("never grants sms.send to a non-admin role", () => {
    const nonAdmin = (Object.keys(ROLE_SCOPES) as Role[]).filter((r) => r !== "admin");
    for (const role of nonAdmin) {
      expect(hasScope(scopesForRole(role), "sms.send")).toBe(false);
    }
  });

  it("gives the registration clerk least-privilege comms (registration only)", () => {
    const scopes = scopesForRole("registration_clerk");
    expect(hasScope(scopes, "comms.send_registration")).toBe(true);
    expect(hasScope(scopes, "comms.send")).toBe(false);
  });

  it("gives every clerk role task.read + task.write", () => {
    const clerkRoles: Role[] = [
      "registration_clerk",
      "voter_contact_clerk",
      "list_data_clerk",
      "compliance_clerk",
      "events_clerk",
      "social_comms_clerk",
      "team_captain",
      "admin",
    ];
    for (const role of clerkRoles) {
      expect(hasScope(scopesForRole(role), "task.read")).toBe(true);
      expect(hasScope(scopesForRole(role), "task.write")).toBe(true);
    }
  });

  it("gives the team captain team scopes but not send/approve powers", () => {
    const scopes = scopesForRole("team_captain");
    expect(hasScope(scopes, "team.read")).toBe(true);
    expect(hasScope(scopes, "team.manage")).toBe(true);
    expect(hasScope(scopes, "voter.read")).toBe(true);
    // Least privilege: a captain manages people, not comms/finance.
    expect(hasScope(scopes, "comms.approve")).toBe(false);
    expect(hasScope(scopes, "sms.send")).toBe(false);
  });

  it("limits the public build to voter.read", () => {
    expect(scopesForRole("public")).toEqual(["voter.read"]);
  });

  it("returns no scopes for an unknown role", () => {
    expect(scopesForRole("nope" as Role)).toEqual([]);
  });
});
