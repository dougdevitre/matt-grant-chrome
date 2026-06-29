// Phase clock: server-authoritative election windows. Boundaries are evaluated
// as UTC instants (Central end-of-day == 04:59:59Z next day during CDT).

import { currentPhase, registrationSendsAllowed } from "../phase.js";

describe("currentPhase", () => {
  it("is PHASE_1_REGISTER through the Jul 8 CDT deadline", () => {
    expect(currentPhase(new Date("2026-06-29T12:00:00Z"))).toBe("PHASE_1_REGISTER");
    // Exactly the inclusive boundary.
    expect(currentPhase(new Date("2026-07-09T04:59:59Z"))).toBe("PHASE_1_REGISTER");
  });

  it("rolls to PHASE_2_PLAN one second after the register deadline", () => {
    expect(currentPhase(new Date("2026-07-09T05:00:00Z"))).toBe("PHASE_2_PLAN");
    expect(currentPhase(new Date("2026-07-21T04:59:59Z"))).toBe("PHASE_2_PLAN");
  });

  it("rolls to PHASE_3_TURNOUT when early voting opens", () => {
    expect(currentPhase(new Date("2026-07-21T05:00:00Z"))).toBe("PHASE_3_TURNOUT");
    expect(currentPhase(new Date("2026-08-05T04:59:59Z"))).toBe("PHASE_3_TURNOUT");
  });

  it("is PHASE_CLOSED after election day ends", () => {
    expect(currentPhase(new Date("2026-08-05T05:00:00Z"))).toBe("PHASE_CLOSED");
    expect(currentPhase(new Date("2027-01-01T00:00:00Z"))).toBe("PHASE_CLOSED");
  });
});

describe("registrationSendsAllowed", () => {
  it("is allowed only during PHASE_1_REGISTER", () => {
    expect(registrationSendsAllowed(new Date("2026-06-29T12:00:00Z"))).toBe(true);
    expect(registrationSendsAllowed(new Date("2026-07-09T04:59:59Z"))).toBe(true);
    // After the deadline registration sends are blocked.
    expect(registrationSendsAllowed(new Date("2026-07-09T05:00:00Z"))).toBe(false);
    expect(registrationSendsAllowed(new Date("2026-08-01T00:00:00Z"))).toBe(false);
  });
});
