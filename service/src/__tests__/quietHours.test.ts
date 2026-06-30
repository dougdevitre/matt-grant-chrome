import { afterEach, describe, expect, it } from "vitest";
import {
  quietHoursConfig,
  tzForContact,
  hourInTz,
  isQuietHours,
} from "../lib/quietHours.js";
import type { Contact } from "../lib/types.js";

const CHI = "America/Chicago";

// America/Chicago is UTC-5 in July (CDT). Reference instants below are chosen so
// the local clock hour is unambiguous.
const at = (iso: string) => new Date(iso);

function contactWithZip(zip: string | null): Contact {
  return {
    id: "c1",
    firstName: "A",
    lastName: "B",
    phone: null,
    email: null,
    addressLine1: null,
    city: null,
    zip,
    inDistrict: null,
    censusBlock: null,
    regStatus: "unknown",
    voteStatus: "unknown",
    consentSms: false,
    consentEmail: false,
    consentSource: null,
    consentAt: null,
    optOut: false,
    tags: [],
    assignedClerkId: null,
    contactKey: "k",
    source: "test",
    version: 0,
    createdAt: "",
    updatedAt: "",
  };
}

afterEach(() => {
  delete process.env.SMS_QUIET_ENABLED;
  delete process.env.SMS_QUIET_START;
  delete process.env.SMS_QUIET_END;
  delete process.env.SMS_QUIET_TZ;
});

describe("hourInTz", () => {
  it("converts a UTC instant to the local Central hour", () => {
    expect(hourInTz(at("2026-07-01T17:00:00Z"), CHI)).toBe(12); // noon Central
    expect(hourInTz(at("2026-07-01T07:00:00Z"), CHI)).toBe(2); // 2am Central
  });
});

describe("isQuietHours (8am–9pm window)", () => {
  const quiet = (iso: string) => isQuietHours(at(iso), CHI, 8, 21);

  it("is quiet before 8am Central", () => {
    expect(quiet("2026-07-01T07:00:00Z")).toBe(true); // 2am
    expect(quiet("2026-07-01T12:59:00Z")).toBe(true); // 7:59am
  });

  it("is allowed at exactly 8am and through the day", () => {
    expect(quiet("2026-07-01T13:00:00Z")).toBe(false); // 8:00am
    expect(quiet("2026-07-01T17:00:00Z")).toBe(false); // noon
  });

  it("is quiet at exactly 9pm (end is exclusive) and after", () => {
    expect(quiet("2026-07-02T02:00:00Z")).toBe(true); // 9:00pm
    expect(quiet("2026-07-02T04:00:00Z")).toBe(true); // 11:00pm
  });
});

describe("quietHoursConfig", () => {
  it("defaults to enabled 8–21 America/Chicago", () => {
    expect(quietHoursConfig()).toEqual({
      enabled: true,
      startHour: 8,
      endHour: 21,
      tz: "America/Chicago",
    });
  });

  it("honors overrides and the disable flag", () => {
    process.env.SMS_QUIET_ENABLED = "false";
    process.env.SMS_QUIET_START = "9";
    process.env.SMS_QUIET_END = "20";
    process.env.SMS_QUIET_TZ = "America/New_York";
    expect(quietHoursConfig()).toEqual({
      enabled: false,
      startHour: 9,
      endHour: 20,
      tz: "America/New_York",
    });
  });

  it("falls back to defaults on out-of-range values", () => {
    process.env.SMS_QUIET_START = "99";
    process.env.SMS_QUIET_END = "-3";
    const c = quietHoursConfig();
    expect(c.startHour).toBe(8);
    expect(c.endHour).toBe(21);
  });
});

describe("tzForContact", () => {
  it("uses the default tz for MO-02 (Central) zips and when no contact", () => {
    expect(tzForContact(contactWithZip("63031"), CHI)).toBe(CHI);
    expect(tzForContact(undefined, CHI)).toBe(CHI);
  });

  it("infers a different tz for clearly non-Central zips", () => {
    expect(tzForContact(contactWithZip("10001"), CHI)).toBe("America/New_York");
    expect(tzForContact(contactWithZip("90210"), CHI)).toBe("America/Los_Angeles");
  });
});
