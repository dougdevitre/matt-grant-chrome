// Canonical RBAC. The service is the source of truth; the extension keeps a
// display-only mirror for hiding UI. Every protected route re-checks here.

import type { Role, Scope } from "./lib/types.js";

export const ALL_SCOPES: Scope[] = [
  "voter.read",
  "voter.write",
  "contact.log",
  "list.import",
  "list.tag",
  "comms.draft",
  "comms.send",
  "comms.send_registration",
  "comms.approve",
  "sms.send",
  "optout.manage",
  "events.write",
  "finance.read",
  "audit.read",
  "task.read",
  "task.write",
];

// Every clerk role works tasks, so all carry task.read + task.write.
const TASK: Scope[] = ["task.read", "task.write"];

export const ROLE_SCOPES: Record<Role, Scope[]> = {
  // Registration Clerk can send approved REGISTRATION templates to their own
  // contacts (least-privilege: not full comms.send).
  registration_clerk: [
    "voter.read",
    "voter.write",
    "contact.log",
    "comms.send_registration",
    ...TASK,
  ],
  voter_contact_clerk: ["voter.read", "contact.log", ...TASK],
  list_data_clerk: ["voter.read", "list.import", "list.tag", ...TASK],
  compliance_clerk: ["comms.approve", "optout.manage", "audit.read", ...TASK],
  events_clerk: ["events.write", "voter.read", ...TASK],
  social_comms_clerk: ["comms.draft", "comms.send", "finance.read", ...TASK],
  admin: ALL_SCOPES,
  // The public/voter-facing build sees civic info but performs no clerk actions.
  public: ["voter.read"],
};

export function scopesForRole(role: Role): Scope[] {
  return ROLE_SCOPES[role] ?? [];
}

export function hasScope(scopes: Scope[], needed: Scope): boolean {
  return scopes.includes(needed);
}
