// Server-authoritative election phase clock for MO-02 Primary, Aug 4, 2026.
// All boundaries are evaluated in America/Chicago (Central) time.
//
// Facts (verify against your local election authority before launch):
//   - Voter registration deadline: Wed Jul 8, 2026 (no same-day registration)
//   - No-excuse in-person early voting begins: Tue Jul 21, 2026
//   - Primary election day: Tue Aug 4, 2026

import type { Phase, PhaseConfig } from "./lib/types.js";

// Inclusive end-of-day Central boundaries, expressed as UTC instants.
// Central is UTC-5 during DST (summer), so end-of-day 23:59:59 CDT == 04:59:59Z next day.
const REGISTER_END = Date.parse("2026-07-09T04:59:59Z"); // end of Jul 8 CDT
const PLAN_END = Date.parse("2026-07-21T04:59:59Z"); // end of Jul 20 CDT
const TURNOUT_END = Date.parse("2026-08-05T04:59:59Z"); // end of Aug 4 CDT

export function currentPhase(now: Date = new Date()): Phase {
  const t = now.getTime();
  if (t <= REGISTER_END) return "PHASE_1_REGISTER";
  if (t <= PLAN_END) return "PHASE_2_PLAN";
  if (t <= TURNOUT_END) return "PHASE_3_TURNOUT";
  return "PHASE_CLOSED";
}

const CONFIG: Record<Phase, Omit<PhaseConfig, "phase">> = {
  PHASE_1_REGISTER: {
    label: "Register",
    primaryCta: "Register by Jul 8 at sos.mo.gov",
    nextDeadline: "2026-07-08T23:59:59-05:00",
  },
  PHASE_2_PLAN: {
    label: "Make a plan",
    primaryCta: "Confirm your registration and make a plan to vote",
    nextDeadline: "2026-07-21T00:00:00-05:00",
  },
  PHASE_3_TURNOUT: {
    label: "Turn out",
    primaryCta: "Vote early or on Aug 4 — request the Republican ballot",
    nextDeadline: "2026-08-04T19:00:00-05:00",
  },
  PHASE_CLOSED: {
    label: "Election closed",
    primaryCta: "View official results at sos.mo.gov",
    nextDeadline: "2026-08-04T19:00:00-05:00",
  },
};

export function phaseConfig(now: Date = new Date()): PhaseConfig {
  const phase = currentPhase(now);
  return { phase, ...CONFIG[phase] };
}

// Registration-phase sends are only allowed during PHASE_1.
export function registrationSendsAllowed(now: Date = new Date()): boolean {
  return currentPhase(now) === "PHASE_1_REGISTER";
}
