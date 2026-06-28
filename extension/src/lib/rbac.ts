// Display-only role labels for the panel header. Scope enforcement lives on
// the server; this is for human-readable UI.

import type { Role } from "./types.js";

export const ROLE_LABELS: Record<Role, string> = {
  registration_clerk: "Registration Clerk",
  voter_contact_clerk: "Voter Contact Clerk",
  list_data_clerk: "List & Data Clerk",
  compliance_clerk: "Compliance Clerk",
  events_clerk: "Events & Scheduler Clerk",
  social_comms_clerk: "Social & Comms Clerk",
  admin: "Campaign Admin",
  public: "Voter",
};
