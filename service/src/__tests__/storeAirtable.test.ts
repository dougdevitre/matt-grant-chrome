// Airtable StorePort adapter, verified without live secrets by stubbing fetch
// with a tiny in-memory fake of Airtable's REST API (POST create, GET list with
// offset pagination + filterByFormula equality, PATCH by id). Proves the adapter
// speaks Airtable's contract: auth header, Data blob + queryable columns, upsert,
// pagination, and the new filterByFormula point reads.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAirtableStore } from "../lib/storeAirtable.js";
import { verifyAuditChain } from "../lib/auditChain.js";

interface FakeRecord {
  id: string;
  fields: Record<string, unknown>;
}

function makeFakeAirtable() {
  const tables = new Map<string, FakeRecord[]>();
  const calls: { method: string; table: string; auth?: string }[] = [];
  let counter = 0;
  const PAGE = 2; // small page size so pagination is exercised

  const tableOf = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };

  const resp = (status: number, data: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });

  const fetchImpl = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean); // [v0, baseId, table]
    const table = decodeURIComponent(parts[parts.length - 1]);
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ method, table, auth: init.headers?.Authorization });
    const recs = tableOf(table);

    if (method === "GET") {
      const formula = u.searchParams.get("filterByFormula");
      let matched = recs;
      if (formula) {
        const m = /^\{([^}]+)\}='(.*)'$/.exec(formula);
        if (m) {
          const col = m[1];
          const val = m[2].replace(/\\'/g, "'");
          matched = recs.filter((r) => r.fields[col] === val);
        }
      }
      const sortField = u.searchParams.get("sort[0][field]");
      if (sortField) {
        const dir = u.searchParams.get("sort[0][direction]") === "desc" ? -1 : 1;
        matched = [...matched].sort(
          (a, b) => (Number(a.fields[sortField] ?? 0) - Number(b.fields[sortField] ?? 0)) * dir
        );
      }
      const maxRecords = u.searchParams.get("maxRecords");
      if (maxRecords) {
        return resp(200, { records: matched.slice(0, Number(maxRecords)) });
      }
      const start = u.searchParams.get("offset") ? Number(u.searchParams.get("offset")) : 0;
      const slice = matched.slice(start, start + PAGE);
      const offset = start + PAGE < matched.length ? String(start + PAGE) : undefined;
      return resp(200, { records: slice, offset });
    }

    if (method === "POST") {
      const body = JSON.parse(init.body!);
      const created = body.records.map((r: { fields: Record<string, unknown> }) => {
        const rec = { id: `rec${++counter}`, fields: r.fields };
        recs.push(rec);
        return rec;
      });
      return resp(200, { records: created });
    }

    if (method === "PATCH") {
      const body = JSON.parse(init.body!);
      const updated = body.records.map((r: { id: string; fields: Record<string, unknown> }) => {
        const existing = recs.find((x) => x.id === r.id);
        if (existing) existing.fields = r.fields;
        return existing ?? { id: r.id, fields: r.fields };
      });
      return resp(200, { records: updated });
    }
    return resp(405, { error: "method_not_allowed" });
  };

  return { fetchImpl, tables, calls };
}

function newTask(zip: string | null) {
  return {
    kind: "call",
    title: "Call back supporters",
    detail: null,
    requiresScope: "task.read" as const,
    phases: ["PHASE_1_REGISTER" as const],
    priority: 50,
    dueAt: null,
    zip,
  };
}

let fake: ReturnType<typeof makeFakeAirtable>;

beforeEach(() => {
  process.env.AIRTABLE_PAT = "test-pat";
  delete process.env.AIRTABLE_BASE_ID;
  fake = makeFakeAirtable();
  vi.stubGlobal("fetch", fake.fetchImpl);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AIRTABLE_PAT;
});

describe("Airtable adapter", () => {
  it("creates a task with Data + queryable columns and Bearer auth, then reads it back", async () => {
    const store = await makeAirtableStore();
    const task = await store.createTask(newTask("63031"));

    const post = fake.calls.find((c) => c.method === "POST" && c.table === "Tasks");
    expect(post?.auth).toBe("Bearer test-pat");

    const rec = fake.tables.get("Tasks")![0];
    expect(rec.fields.RecordId).toBe(task.id);
    expect(rec.fields.Status).toBe("open");
    expect(rec.fields.Zip).toBe("63031");
    expect(JSON.parse(rec.fields.Data as string).id).toBe(task.id);

    const got = await store.getTask(task.id);
    expect(got?.id).toBe(task.id);
    expect(await store.getTask("missing")).toBeUndefined();
  });

  it("upserts via PATCH when the RecordId already exists (no duplicate row)", async () => {
    const store = await makeAirtableStore();
    const task = await store.createTask(newTask("63031"));
    await store.putTask({ ...task, status: "claimed" });

    expect(fake.calls.some((c) => c.method === "PATCH" && c.table === "Tasks")).toBe(true);
    expect(fake.tables.get("Tasks")!.length).toBe(1);
    expect((await store.getTask(task.id))?.status).toBe("claimed");
  });

  it("paginates listAll across offset pages", async () => {
    const store = await makeAirtableStore();
    await store.createTask(newTask("1"));
    await store.createTask(newTask("2"));
    await store.createTask(newTask("3"));
    const all = await store.listTasks();
    expect(all.map((t) => t.zip).sort()).toEqual(["1", "2", "3"]);
  });

  it("round-trips the outbox via the IdempotencyKey point read", async () => {
    const store = await makeAirtableStore();
    const entry = {
      id: "o1",
      templateId: "t1",
      channel: "sms" as const,
      contactKey: "ck",
      idempotencyKey: "idem-1",
      status: "sent" as const,
      reason: null,
      createdAt: "2026-07-01T00:00:00Z",
    };
    await store.appendOutbox(entry);
    expect(fake.tables.get("Outbox")![0].fields.IdempotencyKey).toBe("idem-1");
    expect((await store.getOutboxByKey("idem-1"))?.id).toBe("o1");
    expect(await store.getOutboxByKey("nope")).toBeUndefined();
  });

  it("fails closed on a formula-injecting key (quote) without querying", async () => {
    const store = await makeAirtableStore();
    const before = fake.calls.length;
    expect(await store.getOutboxByKey("x') | TRUE() & ('")).toBeUndefined();
    // No GET was issued for the malicious value.
    expect(fake.calls.length).toBe(before);
  });

  it("round-trips opt-out via the ContactKey point read", async () => {
    const store = await makeAirtableStore();
    await store.addOptOut("contactkey-abc");
    expect(fake.tables.get("OptOut")![0].fields.ContactKey).toBe("contactkey-abc");
    expect(await store.isOptedOut("contactkey-abc")).toBe(true);
    expect(await store.isOptedOut("other")).toBe(false);
  });

  it("chains the audit log so it is tamper-evident, and verifies", async () => {
    const store = await makeAirtableStore();
    for (let n = 1; n <= 3; n++) {
      await store.appendAudit({
        id: `a${n}`,
        ts: `2026-07-0${n}T00:00:00Z`,
        clerkId: `c${n}`,
        action: "task.claim",
        entity: "task",
        entityId: `t${n}`,
      });
    }

    const audit = await store.readAudit();
    expect(audit).toHaveLength(3);
    // Seq increments and prevHash links to the prior entry's hash.
    expect(audit.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(audit[0].prevHash).toBeNull();
    expect(audit[1].prevHash).toBe(audit[0].hash);
    expect(audit[2].prevHash).toBe(audit[1].hash);
    // Seq + Hash are stored as queryable columns.
    expect(fake.tables.get("Audit")![0].fields.Seq).toBe(1);
    expect(verifyAuditChain(audit)).toEqual({ ok: true, brokeAt: -1 });

    // Tampering with a stored row is detected.
    const tampered = audit.map((e, i) => (i === 1 ? { ...e, action: "task.delete" } : e));
    expect(verifyAuditChain(tampered)).toEqual({ ok: false, brokeAt: 1 });
  });

  it("surfaces the Airtable error body in the thrown message", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 422,
      json: async () => ({}),
      text: async () => '{"error":"INVALID_FILTER"}',
    }));
    const store = await makeAirtableStore();
    await expect(store.listTasks()).rejects.toThrow(/airtable_422.*INVALID_FILTER/);
  });
});
