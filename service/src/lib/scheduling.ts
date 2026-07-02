// Scheduling logic (Phase 1 async store + Phase 2 calendar hook). Shift claiming
// enforces capacity and prevents double-claims; on success it fires a calendar
// invite (non-blocking — a failed invite never fails the claim).

import { currentPhase } from "../phase.js";
import { audit, getStore } from "./store.js";
import { getCalendar } from "./calendar.js";
import type {
  CampaignEvent,
  EventWithShifts,
  Phase,
  Shift,
} from "./types.js";
import type { NewEvent, NewShift } from "./store.js";

export interface ShiftError {
  ok: false;
  code: "not_found" | "full" | "already_claimed" | "version_conflict";
}
export interface ShiftOk {
  ok: true;
  shift: Shift;
}
export type ShiftResult = ShiftError | ShiftOk;

export async function listEvents(
  opts: { county?: string | null; zip?: string | null } = {},
  now: Date = new Date()
): Promise<EventWithShifts[]> {
  const store = await getStore();
  const phase: Phase = currentPhase(now);
  const events = (await store.listEvents())
    .filter((e) => e.phases.includes(phase))
    .filter((e) => (opts.county ? e.county === opts.county : true))
    .filter((e) => (opts.zip && e.zip ? e.zip === opts.zip : true))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const withShifts: EventWithShifts[] = [];
  for (const e of events) {
    withShifts.push({ ...e, shifts: await store.shiftsForEvent(e.id) });
  }
  return withShifts;
}

export async function createEvent(
  input: NewEvent,
  clerkId: string
): Promise<CampaignEvent> {
  const store = await getStore();
  const event = await store.createEvent(input);
  await audit(store, clerkId, "event.create", "event", event.id);

  // Phase 2: mirror the event to the campaign calendar (best-effort).
  void (await getCalendar())
    .createInvite({
      summary: event.title,
      description: `Campaign event (${event.kind})`,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      location: event.venueName,
    })
    .catch(() => undefined);

  return event;
}

export async function addShift(
  input: NewShift,
  clerkId: string
): Promise<Shift | null> {
  const store = await getStore();
  if (!(await store.getEvent(input.eventId))) return null;
  const shift = await store.createShift(input);
  await audit(store, clerkId, "shift.create", "shift", shift.id);
  return shift;
}

export async function claimShift(
  shiftId: string,
  clerkId: string,
  expectedVersion?: number
): Promise<ShiftResult> {
  const store = await getStore();
  const shift = await store.getShift(shiftId);
  if (!shift) return { ok: false, code: "not_found" };
  if (expectedVersion != null && expectedVersion !== shift.version)
    return { ok: false, code: "version_conflict" };
  if (shift.claimedBy.includes(clerkId))
    return { ok: false, code: "already_claimed" };
  if (shift.claimedBy.length >= shift.capacity)
    return { ok: false, code: "full" };

  const updated: Shift = {
    ...shift,
    claimedBy: [...shift.claimedBy, clerkId],
    version: shift.version + 1,
  };
  // Compare-and-swap on the version we read: if another claim landed in the
  // get→put window, the write is rejected and we report the conflict rather than
  // silently over-filling the shift past capacity.
  const written = await store.putShiftIfVersion(updated, shift.version);
  if (!written) return { ok: false, code: "version_conflict" };
  await audit(store, clerkId, "shift.claim", "shift", shiftId);

  // Phase 2: send the volunteer a calendar invite (non-blocking).
  void (await getCalendar())
    .createInvite({
      summary: `Volunteer shift: ${shift.role}`,
      description: "Thanks for signing up. Details in the campaign panel.",
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      attendeeKey: clerkId,
    })
    .catch(() => undefined);

  return { ok: true, shift: updated };
}

export async function myShifts(clerkId: string): Promise<Shift[]> {
  const store = await getStore();
  return store.shiftsForClerk(clerkId);
}
