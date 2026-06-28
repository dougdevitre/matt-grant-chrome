// Task fulfillment logic, now against the async StorePort (Phase 1). Phase +
// scope gating is enforced here in addition to route middleware.

import { currentPhase } from "../phase.js";
import { audit, getStore } from "./store.js";
import type { Phase, Scope, Task } from "./types.js";

export interface TaskActionError {
  ok: false;
  code:
    | "not_found"
    | "forbidden_scope"
    | "phase_closed"
    | "already_claimed"
    | "not_assignee"
    | "version_conflict"
    | "bad_status";
}
export interface TaskActionOk {
  ok: true;
  task: Task;
}
export type TaskActionResult = TaskActionError | TaskActionOk;

export async function buildQueue(
  clerkId: string,
  scopes: Scope[],
  opts: { zip?: string | null } = {},
  now: Date = new Date()
): Promise<Task[]> {
  const store = await getStore();
  const phase = currentPhase(now);
  const all = await store.listTasks();
  return all
    .filter((t) => {
      const mine = t.assignedClerkId === clerkId;
      const claimable = t.status === "open";
      if (!claimable && !mine) return false;
      if (t.status === "done" || t.status === "skipped") return false;
      if (!t.phases.includes(phase)) return false;
      if (!scopes.includes(t.requiresScope)) return false;
      if (opts.zip && t.zip && t.zip !== opts.zip) return false;
      return true;
    })
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const ad = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
      const bd = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
      return ad - bd;
    });
}

function phaseAllows(task: Task, now: Date): boolean {
  const phase: Phase = currentPhase(now);
  return task.phases.includes(phase);
}

export async function claimTask(
  id: string,
  clerkId: string,
  scopes: Scope[],
  expectedVersion?: number,
  now: Date = new Date()
): Promise<TaskActionResult> {
  const store = await getStore();
  const task = await store.getTask(id);
  if (!task) return { ok: false, code: "not_found" };
  if (!scopes.includes(task.requiresScope))
    return { ok: false, code: "forbidden_scope" };
  if (!phaseAllows(task, now)) return { ok: false, code: "phase_closed" };
  if (expectedVersion != null && expectedVersion !== task.version)
    return { ok: false, code: "version_conflict" };
  if (task.assignedClerkId && task.assignedClerkId !== clerkId)
    return { ok: false, code: "already_claimed" };
  if (task.status === "done" || task.status === "skipped")
    return { ok: false, code: "bad_status" };

  const updated: Task = {
    ...task,
    status: "claimed",
    assignedClerkId: clerkId,
    version: task.version + 1,
    updatedAt: now.toISOString(),
  };
  await store.putTask(updated);
  await audit(store, clerkId, "task.claim", "task", id);
  return { ok: true, task: updated };
}

export async function completeTask(
  id: string,
  clerkId: string,
  scopes: Scope[],
  now: Date = new Date()
): Promise<TaskActionResult> {
  const store = await getStore();
  const task = await store.getTask(id);
  if (!task) return { ok: false, code: "not_found" };
  if (!scopes.includes(task.requiresScope))
    return { ok: false, code: "forbidden_scope" };
  if (task.assignedClerkId !== clerkId) return { ok: false, code: "not_assignee" };
  // Re-evaluate phase at completion: a registration task drafted before Jul 8
  // cannot be completed after the deadline.
  if (!phaseAllows(task, now)) return { ok: false, code: "phase_closed" };

  const updated: Task = {
    ...task,
    status: "done",
    version: task.version + 1,
    updatedAt: now.toISOString(),
  };
  await store.putTask(updated);
  await audit(store, clerkId, "task.complete", "task", id);
  return { ok: true, task: updated };
}

export async function skipTask(
  id: string,
  clerkId: string,
  reason: string | null,
  now: Date = new Date()
): Promise<TaskActionResult> {
  const store = await getStore();
  const task = await store.getTask(id);
  if (!task) return { ok: false, code: "not_found" };
  if (task.assignedClerkId && task.assignedClerkId !== clerkId)
    return { ok: false, code: "not_assignee" };

  const updated: Task = {
    ...task,
    status: "skipped",
    skipReason: reason,
    assignedClerkId: clerkId,
    version: task.version + 1,
    updatedAt: now.toISOString(),
  };
  await store.putTask(updated);
  await audit(store, clerkId, "task.skip", "task", id);
  return { ok: true, task: updated };
}
