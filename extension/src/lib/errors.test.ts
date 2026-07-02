import { describe, expect, it } from "vitest";
import { messageForError } from "./errors.js";

describe("messageForError", () => {
  it("maps known SMS/consent codes to human copy", () => {
    expect(messageForError("quiet_hours")).toMatch(/texting hours/i);
    expect(messageForError("forbidden")).toMatch(/isn't available for your role/i);
    expect(messageForError("invalid_token")).toMatch(/session expired/i);
  });

  it("maps the generic *_failed codes without leaking the code", () => {
    for (const c of ["load_failed", "resolve_failed", "save_failed", "batch_failed"]) {
      const msg = messageForError(c);
      expect(msg).not.toContain("_");
      expect(msg).toMatch(/try again/i);
    }
  });

  it("never surfaces an unknown snake_case code verbatim", () => {
    expect(messageForError("some_unexpected_code")).toBe("Something went wrong. Please try again.");
  });

  it("passes through a already-human message", () => {
    expect(messageForError("Couldn't reach the service.")).toBe("Couldn't reach the service.");
  });
});
