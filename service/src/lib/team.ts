// Team-captain logic. A captain sees the volunteers on their roster and each
// volunteer's work. The roster (lib TeamMember) is the only source of volunteer
// display names — the rest of the system knows clerks only as opaque JWT
// subjects. Ownership ("this is MY volunteer") is checked here, inline, because
// the coarse role→scope middleware can't express per-team gating.

import { audit, getStore } from "./store.js";
import { getMailer } from "./mailer.js";
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

// --- roster management (Phase 3) --------------------------------------------

export type InviteResult =
  | { ok: true; member: TeamMember }
  | { ok: false; code: "invalid" | "duplicate" };

/**
 * Invite a volunteer onto a captain's team by email. The row is "pending"
 * (clerkId=null) until that person first signs in with this email, at which
 * point bindPendingVolunteer binds their clerkId — so no Clerk id lookup is
 * needed. An admin may pass a known clerkId to add a bound member directly.
 */
export async function inviteVolunteer(
  input: {
    displayName: string;
    email: string;
    phone?: string | null;
    teamId?: string | null;
    clerkId?: string | null;
  },
  captainClerkId: string
): Promise<InviteResult> {
  const store = await getStore();
  const displayName = input.displayName.trim();
  const email = input.email.trim().toLowerCase();
  if (!displayName || !/.+@.+\..+/.test(email)) return { ok: false, code: "invalid" };
  if (await store.getTeamMemberByEmail(email)) return { ok: false, code: "duplicate" };

  const member = await store.createTeamMember({
    clerkId: input.clerkId ?? null,
    displayName,
    email,
    phone: input.phone ?? null,
    teamId: input.teamId ?? null,
    captainClerkId,
    active: true,
  });
  await audit(store, captainClerkId, "team.invite", "team", member.id);
  return { ok: true, member };
}

export type RemoveResult = { ok: true } | { ok: false; code: "not_found" | "forbidden" };

/** Soft-remove (deactivate) a roster member. Ownership: the caller must be the
 *  member's captain, or an admin. Kept as active=false so audit/history stand. */
export async function removeVolunteer(
  memberId: string,
  byClerkId: string,
  isAdmin: boolean
): Promise<RemoveResult> {
  const store = await getStore();
  const member = await store.getTeamMember(memberId);
  if (!member) return { ok: false, code: "not_found" };
  if (!isAdmin && member.captainClerkId !== byClerkId) return { ok: false, code: "forbidden" };
  await store.putTeamMember({ ...member, active: false, updatedAt: new Date().toISOString() });
  await audit(store, byClerkId, "team.remove", "team", member.id);
  return { ok: true };
}

/**
 * Bind a pending invite to a clerkId now that this email has signed in. Called
 * from the token-exchange path where the verified identity carries email + sub.
 * Best-effort + idempotent; never throws into the sign-in flow.
 */
export async function bindPendingVolunteer(
  email: string | null | undefined,
  clerkId: string
): Promise<void> {
  if (!email) return;
  try {
    const store = await getStore();
    const member = await store.getTeamMemberByEmail(email);
    if (member && member.clerkId === null) {
      await store.putTeamMember({ ...member, clerkId, updatedAt: new Date().toISOString() });
    }
  } catch {
    // A roster bind must never block sign-in.
  }
}

/**
 * Send a captain's reminder to a volunteer by email. Deliberately bypasses the
 * comms pipeline (that's voter-outreach compliance) — this is an internal note,
 * so it goes straight through the mailer port. `sent` is false when the mailer
 * isn't configured (noop) or the volunteer has no email.
 */
export async function nudgeVolunteer(
  targetClerkId: string,
  message: string,
  byClerkId: string
): Promise<{ sent: boolean; note?: string }> {
  const store = await getStore();
  const member = await store.getTeamMemberByClerkId(targetClerkId);
  if (!member) return { sent: false, note: "volunteer_not_found" };
  if (!member.email) return { sent: false, note: "no_email" };

  const result = await (await getMailer()).send({
    to: member.email,
    subject: "A note from your team captain",
    body: message,
  });
  await audit(store, byClerkId, "team.nudge", "team", targetClerkId);

  const configured = (process.env.MAILER_DRIVER ?? "noop") !== "noop";
  const delivered = configured && result.ok;
  return { sent: delivered, note: delivered ? undefined : "mailer_not_configured" };
}
