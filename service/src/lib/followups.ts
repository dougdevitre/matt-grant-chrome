// GOTV follow-up reminders. There is no background sender — reminders are
// stored with a due time and surfaced to a clerk (see GET /followups?due=now),
// who sends via the normal approved-send flow. This keeps a human in the loop
// for TCPA. All mutations are audited.

import { audit, getStore } from "./store.js";
import type { FollowUp } from "./types.js";

export async function scheduleFollowUp(input: {
  contactId: string;
  clerkId: string;
  templateId: string | null;
  dueAt: string;
  note: string | null;
}): Promise<FollowUp | null> {
  const store = await getStore();
  const contact = await store.getContact(input.contactId);
  if (!contact) return null;
  const f = await store.createFollowUp({
    contactId: input.contactId,
    clerkId: input.clerkId,
    templateId: input.templateId,
    dueAt: input.dueAt,
    note: input.note,
  });
  await audit(store, input.clerkId, "followup.schedule", "followup", f.id);
  return f;
}

/** Pending reminders that have come due at/before `nowIso` (the clerk queue). */
export async function listDueFollowUps(nowIso: string): Promise<FollowUp[]> {
  const store = await getStore();
  return store.listFollowUps({ status: "pending", dueBefore: nowIso });
}

export async function resolveFollowUp(
  id: string,
  clerkId: string,
  status: "done" | "cancelled"
): Promise<FollowUp | null> {
  const store = await getStore();
  const f = await store.getFollowUp(id);
  if (!f) return null;
  const updated: FollowUp = { ...f, status, updatedAt: new Date().toISOString() };
  await store.putFollowUp(updated);
  await audit(store, clerkId, `followup.${status}`, "followup", id);
  return updated;
}
