// Display-only role labels for the panel header.

import { describe, expect, it } from "vitest";
import { ROLE_LABELS } from "./rbac.js";
import type { Role } from "./types.js";

describe("ROLE_LABELS", () => {
  it("has a human-readable label for every role", () => {
    const roles: Role[] = [
      "registration_clerk",
      "voter_contact_clerk",
      "list_data_clerk",
      "compliance_clerk",
      "events_clerk",
      "social_comms_clerk",
      "admin",
      "public",
    ];
    for (const role of roles) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
    expect(ROLE_LABELS.admin).toBe("Campaign Admin");
    expect(ROLE_LABELS.public).toBe("Voter");
  });
});
