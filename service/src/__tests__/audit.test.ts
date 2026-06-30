// Tamper-evident audit chain. Each appended event hashes its content + the prior
// hash, so editing any earlier record breaks the chain. Uses the production
// verifier (verifyAuditChain) — the same code the /audit/verify route runs.

import { makeMemoryStore, seedReady } from "../lib/storeMemory.js";
import { verifyAuditChain } from "../lib/auditChain.js";
import type { AuditEvent } from "../lib/types.js";

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

describe("audit hash chain (memory store)", () => {
  it("links each entry to the previous, stamps seq, and verifies clean", async () => {
    const store = makeMemoryStore();
    await seedReady; // seeding writes no audit entries
    for (let n = 1; n <= 3; n++) await store.appendAudit(evt(n));

    const log = await store.readAudit();
    expect(log).toHaveLength(3);
    expect(log.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(log[0].prevHash).toBeNull();
    expect(log[1].prevHash).toBe(log[0].hash);
    expect(log[2].prevHash).toBe(log[1].hash);
    expect(verifyAuditChain(log)).toEqual({ ok: true, brokeAt: -1 });
  });

  it("detects a tampered middle record", async () => {
    const store = makeMemoryStore();
    await seedReady;
    for (let n = 1; n <= 3; n++) await store.appendAudit(evt(n));

    const log = await store.readAudit();
    log[1] = { ...log[1], action: "task.delete" }; // forge after the fact
    const result = verifyAuditChain(log);
    expect(result.ok).toBe(false);
    expect(result.brokeAt).toBe(1);
  });
});
