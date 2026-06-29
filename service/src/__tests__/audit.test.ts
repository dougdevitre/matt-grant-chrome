// Tamper-evident audit chain. Each appended event hashes its content + the
// prior hash, so editing any earlier record breaks the chain on verification.

import { createHash } from "node:crypto";
import { makeMemoryStore, seedReady } from "../lib/storeMemory.js";
import type { AuditEvent } from "../lib/types.js";

function material(prev: string | null | undefined, e: AuditEvent): string {
  return `${prev ?? ""}|${e.id}|${e.ts}|${e.clerkId}|${e.action}|${e.entity}|${e.entityId}`;
}

// Independent re-implementation of the chain check (what a real auditor runs).
function verifyChain(log: AuditEvent[]): { ok: boolean; brokeAt: number } {
  let prev: string | null = null;
  for (let i = 0; i < log.length; i++) {
    const expected = createHash("sha256").update(material(prev, log[i])).digest("hex");
    if (log[i].hash !== expected) return { ok: false, brokeAt: i };
    prev = log[i].hash ?? null;
  }
  return { ok: true, brokeAt: -1 };
}

function evt(n: number): AuditEvent {
  return {
    id: `id-${n}`,
    ts: `2026-07-0${n}T00:00:00Z`,
    clerkId: `clerk-${n}`,
    action: "task.claim",
    entity: "task",
    entityId: `task-${n}`,
  };
}

describe("audit hash chain", () => {
  it("links each entry to the previous and verifies clean", async () => {
    const store = makeMemoryStore();
    await seedReady; // seeding writes no audit entries, but keep ordering deterministic
    for (let n = 1; n <= 3; n++) await store.appendAudit(evt(n));

    const log = await store.readAudit();
    expect(log).toHaveLength(3);
    expect(log[0].prevHash).toBeNull();
    expect(log[1].prevHash).toBe(log[0].hash);
    expect(log[2].prevHash).toBe(log[1].hash);
    expect(verifyChain(log)).toEqual({ ok: true, brokeAt: -1 });
  });

  it("detects a tampered middle record", async () => {
    const store = makeMemoryStore();
    await seedReady;
    for (let n = 1; n <= 3; n++) await store.appendAudit(evt(n));

    const log = await store.readAudit();
    // Forge the middle event's action after the fact.
    log[1] = { ...log[1], action: "task.delete" };
    const result = verifyChain(log);
    expect(result.ok).toBe(false);
    expect(result.brokeAt).toBe(1);
  });
});
