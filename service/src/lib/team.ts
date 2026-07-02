// Team-captain logic. A captain sees the volunteers on their roster and each
// volunteer's work. The roster (lib TeamMember) is the only source of volunteer
// display names — the rest of the system knows clerks only as opaque JWT
// subjects. Ownership ("this is MY volunteer") is checked here, inline, because
// the coarse role→scope middleware can't express per-team gating.

import { getStore } from "./store.js";
import type { TeamMember, VolunteerWork } from "./types.js";

/** Active volunteers this captain manages, sorted by name. */
export async function rosterForCaptain(captainClerkId: string): Promise<TeamMember[]> {
  const store = await getStore();
  return store.listTeamMembers({ captainClerkId, active: true });
}

/** Every active volunteer (admin view). */
export async function fullRoster(): Promise<TeamMember[]> {
  const store = await getStore();
  return store.listTeamMembers({ active: true });
}

/**
 * Whether `captainClerkId` manages the volunteer `targetClerkId`. Admins are
 * expected to bypass this at the call site (they manage everyone).
 */
export async function managesVolunteer(
  captainClerkId: string,
  targetClerkId: string
): Promise<boolean> {
  const store = await getStore();
  const m = await store.getTeamMemberByClerkId(targetClerkId);
  return !!m && m.active && m.captainClerkId === captainClerkId;
}

const ACTIVITY_LIMIT = 20;

/**
 * A volunteer plus their work: tasks assigned to them, shifts they've claimed,
 * and their most recent audit-trail activity (newest first). Returns null when
 * the clerkId isn't on any roster.
 */
export async function volunteerWork(targetClerkId: string): Promise<VolunteerWork | null> {
  const store = await getStore();
  const volunteer = await store.getTeamMemberByClerkId(targetClerkId);
  if (!volunteer) return null;

  const [tasks, shifts, auditLog] = await Promise.all([
    store.listTasks(),
    store.shiftsForClerk(targetClerkId),
    store.readAudit(),
  ]);

  return {
    volunteer,
    tasks: tasks.filter((t) => t.assignedClerkId === targetClerkId),
    shifts,
    recentActivity: auditLog
      .filter((a) => a.clerkId === targetClerkId)
      .slice(-ACTIVITY_LIMIT)
      .reverse(),
  };
}
