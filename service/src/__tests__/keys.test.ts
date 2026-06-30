// contactKeyFor: stable opaque key; CONTACT_KEY_SALT switches to a keyed HMAC so
// leaked keys aren't offline-reversible to PII.

import { afterEach, describe, expect, it } from "vitest";
import { contactKeyFor } from "../lib/keys.js";

afterEach(() => {
  delete process.env.CONTACT_KEY_SALT;
});

describe("contactKeyFor", () => {
  it("is stable and normalizes case/whitespace", () => {
    delete process.env.CONTACT_KEY_SALT;
    expect(contactKeyFor("  Jordan@Example.com ")).toBe(contactKeyFor("jordan@example.com"));
    expect(contactKeyFor("jordan@example.com")).toMatch(/^[0-9a-f]{24}$/);
  });

  it("produces a different key when salted (HMAC) than unsalted (hash)", () => {
    const plain = contactKeyFor("jordan@example.com");
    process.env.CONTACT_KEY_SALT = "server-secret-salt";
    const salted = contactKeyFor("jordan@example.com");
    expect(salted).not.toBe(plain);
    expect(salted).toMatch(/^[0-9a-f]{24}$/);
  });
});
