// Integration: the admin-only "View as" preview on GET /me?as=<role>. The
// preview is cosmetic — scopes are always derived server-side — and it must
// never let a non-admin escalate.

import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../index.js";
import { TEST_JWT_SECRET, tokenFor, bearer } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

describe("GET /me?as= (admin view-as preview)", () => {
  it("lets an admin preview another role's derived scopes", async () => {
    const res = await request(app)
      .get("/me?as=voter_contact_clerk")
      .set("Authorization", bearer(tokenFor("admin")));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("voter_contact_clerk");
    expect(res.body.viewAs).toBe(true);
    // voter_contact_clerk carries contact.log but never sms.send.
    expect(res.body.scopes).toContain("contact.log");
    expect(res.body.scopes).not.toContain("sms.send");
  });

  it("ignores ?as for a non-admin (no privilege escalation)", async () => {
    const res = await request(app)
      .get("/me?as=admin")
      .set("Authorization", bearer(tokenFor("voter_contact_clerk")));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("voter_contact_clerk");
    expect(res.body.viewAs).toBeUndefined();
    expect(res.body.scopes).not.toContain("sms.send");
  });

  it("ignores an unknown ?as value and returns the admin's own identity", async () => {
    const res = await request(app)
      .get("/me?as=not_a_role")
      .set("Authorization", bearer(tokenFor("admin")));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("admin");
    expect(res.body.viewAs).toBeUndefined();
  });
});
