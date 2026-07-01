// Airtable StorePort adapter (Phase 1). Activated by STORE_DRIVER=airtable with
// AIRTABLE_PAT + AIRTABLE_BASE_ID (default base appiuSYCexFUmGIOr) loaded from
// SSM SecureString / env. Never tested from this repo's sandbox; structurally
// complete and typechecked. Each record stores queryable fields plus a `Data`
// JSON blob holding the full typed object — pragmatic and drift-resistant.
//
// Expected tables (create in the base): Tasks, Events, Shifts, Templates,
// Contacts, ContactLogs, OptOut, Outbox, Audit. Each needs a `Data` long-text
// field. Point reads use filterByFormula on these single-line-text columns, so
// they must exist where used: `RecordId` (Tasks/Events/Shifts/Templates/Contacts),
// `ContactKey` (Contacts/OptOut), `IdempotencyKey` (Outbox). The remaining columns
// (Status, Zip, County, Category, RegStatus, Action, EventId) are for human-readable
// filtering in the Airtable UI. See docs/airtable-setup.md.

import { getConfig } from "../config.js";
import { computeAuditHash } from "./auditChain.js";
import type {
  StorePort,
  NewTask,
  NewEvent,
  NewShift,
  NewTemplate,
  NewContact,
  NewContactLog,
  ContactFilter,
} from "./store.js";
import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  CampaignEvent,
  Contact,
  ContactLog,
  MessageTemplate,
  OutboxEntry,
  Shift,
  Task,
} from "./types.js";

const API = "https://api.airtable.com/v0";

interface AirtableRecord<T> {
  id: string;
  fields: { Data: string } & Partial<Record<string, unknown>>;
  _parsed?: T;
}

function now(): string {
  return new Date().toISOString();
}

export async function makeAirtableStore(): Promise<StorePort> {
  const pat = await getConfig("AIRTABLE_PAT");
  const baseId = (await getConfig("AIRTABLE_BASE_ID")) ?? "appiuSYCexFUmGIOr";
  if (!pat) throw new Error("AIRTABLE_PAT not configured");

  async function req<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await fetch(`${API}/${baseId}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${pat}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      // Surface the (PII-free) Airtable error body for debuggability; keep the
      // airtable_<status> code prefix so callers can still match on it.
      const detail = await res.text().catch(() => "");
      throw new Error(`airtable_${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    }
    return (await res.json()) as T;
  }

  // Point read: fetch a single record by an exact column match (server-side
  // filterByFormula) and return its parsed Data blob. Avoids scanning the whole
  // table for get-by-id / get-by-key lookups.
  async function findOneByFormula<T>(
    table: string,
    column: string,
    value: string
  ): Promise<T | undefined> {
    // Airtable formula string literals have no backslash escaping, so a value
    // containing a single quote could break out of the literal. Callers pass
    // server-generated ids / hashed keys / route-validated keys, so fail closed
    // here rather than risk formula injection.
    if (value.includes("'")) return undefined;
    const formula = encodeURIComponent(`{${column}}='${value}'`);
    const res = await req<{ records: AirtableRecord<T>[] }>(
      "GET",
      `${encodeURIComponent(table)}?filterByFormula=${formula}&maxRecords=1`
    );
    const rec = res.records[0];
    return rec ? (JSON.parse(rec.fields.Data) as T) : undefined;
  }

  async function listAll<T>(table: string): Promise<T[]> {
    const out: T[] = [];
    let offset: string | undefined;
    do {
      const qs = offset ? `?offset=${encodeURIComponent(offset)}` : "";
      const page = await req<{ records: AirtableRecord<T>[]; offset?: string }>(
        "GET",
        `${encodeURIComponent(table)}${qs}`
      );
      for (const r of page.records) out.push(JSON.parse(r.fields.Data) as T);
      offset = page.offset;
    } while (offset);
    return out;
  }

  async function create<T extends { id: string }>(
    table: string,
    obj: T,
    extra: Record<string, unknown> = {}
  ): Promise<T> {
    await req("POST", encodeURIComponent(table), {
      records: [{ fields: { Data: JSON.stringify(obj), ...extra } }],
      typecast: true,
    });
    return obj;
  }

  // Upsert by our own id (stored in `Data`). We find the Airtable record id via
  // a filterByFormula match on a `RecordId` column, then PATCH it.
  async function upsert<T extends { id: string }>(
    table: string,
    obj: T,
    extra: Record<string, unknown> = {}
  ): Promise<T> {
    const formula = encodeURIComponent(`{RecordId}='${obj.id}'`);
    const found = await req<{ records: AirtableRecord<T>[] }>(
      "GET",
      `${encodeURIComponent(table)}?filterByFormula=${formula}&maxRecords=1`
    );
    const fields = { Data: JSON.stringify(obj), RecordId: obj.id, ...extra };
    if (found.records[0]) {
      await req("PATCH", encodeURIComponent(table), {
        records: [{ id: found.records[0].id, fields }],
        typecast: true,
      });
    } else {
      await req("POST", encodeURIComponent(table), {
        records: [{ fields }],
        typecast: true,
      });
    }
    return obj;
  }

  const store: StorePort = {
    async listTasks() {
      return listAll<Task>("Tasks");
    },
    async getTask(id) {
      return findOneByFormula<Task>("Tasks", "RecordId", id);
    },
    async putTask(task) {
      return upsert("Tasks", task, { Status: task.status, Zip: task.zip });
    },
    async createTask(input: NewTask) {
      const t: Task = {
        ...input,
        id: randomUUID(),
        status: "open",
        assignedClerkId: null,
        skipReason: null,
        version: 1,
        createdAt: now(),
        updatedAt: now(),
      };
      return upsert("Tasks", t, { Status: t.status, Zip: t.zip });
    },

    async listEvents() {
      return listAll<CampaignEvent>("Events");
    },
    async getEvent(id) {
      return findOneByFormula<CampaignEvent>("Events", "RecordId", id);
    },
    async createEvent(input: NewEvent) {
      const e: CampaignEvent = { ...input, id: randomUUID(), createdAt: now() };
      return upsert("Events", e, { County: e.county });
    },

    async shiftsForEvent(eventId) {
      return (await listAll<Shift>("Shifts")).filter((s) => s.eventId === eventId);
    },
    async shiftsForClerk(clerkId) {
      return (await listAll<Shift>("Shifts")).filter((s) =>
        s.claimedBy.includes(clerkId)
      );
    },
    async getShift(id) {
      return findOneByFormula<Shift>("Shifts", "RecordId", id);
    },
    async putShift(shift) {
      return upsert("Shifts", shift, { EventId: shift.eventId });
    },
    async createShift(input: NewShift) {
      const s: Shift = { ...input, id: randomUUID(), claimedBy: [], version: 1 };
      return upsert("Shifts", s, { EventId: s.eventId });
    },

    async listTemplates() {
      return listAll<MessageTemplate>("Templates");
    },
    async getTemplate(id) {
      return findOneByFormula<MessageTemplate>("Templates", "RecordId", id);
    },
    async createTemplate(input: NewTemplate) {
      const t: MessageTemplate = {
        ...input,
        id: randomUUID(),
        complianceApprovalId: null,
        createdAt: now(),
        updatedAt: now(),
      };
      return upsert("Templates", t, { Category: t.category });
    },
    async putTemplate(template) {
      return upsert("Templates", template, { Category: template.category });
    },
    async isOptedOut(contactKey) {
      const found = await findOneByFormula<{ id: string; contactKey: string }>(
        "OptOut",
        "ContactKey",
        contactKey
      );
      return !!found;
    },
    async addOptOut(contactKey) {
      // Mirror the key into a queryable column so isOptedOut() is a point read.
      await create("OptOut", { id: randomUUID(), contactKey }, { ContactKey: contactKey });
    },
    async getOutboxByKey(idempotencyKey) {
      return findOneByFormula<OutboxEntry>("Outbox", "IdempotencyKey", idempotencyKey);
    },
    async appendOutbox(entry) {
      // IdempotencyKey column makes the replay check a point read.
      return create("Outbox", entry, {
        Status: entry.status,
        IdempotencyKey: entry.idempotencyKey,
      });
    },

    async listContacts(filter: ContactFilter = {}) {
      return (await listAll<Contact>("Contacts")).filter((c) => {
        if (filter.zip && c.zip !== filter.zip) return false;
        if (filter.regStatus && c.regStatus !== filter.regStatus) return false;
        if (filter.voteStatus && c.voteStatus !== filter.voteStatus) return false;
        // notVoted = still needs to turn out: exclude anyone who has cast a
        // ballot already (early/absentee counts as voted).
        if (
          filter.notVoted &&
          (c.voteStatus === "voted" || c.voteStatus === "early_voted")
        )
          return false;
        if (filter.assignedClerkId && c.assignedClerkId !== filter.assignedClerkId)
          return false;
        return true;
      });
    },
    async getContact(id) {
      return findOneByFormula<Contact>("Contacts", "RecordId", id);
    },
    async findContactByKey(contactKey) {
      return findOneByFormula<Contact>("Contacts", "ContactKey", contactKey);
    },
    async createContact(input: NewContact) {
      const c: Contact = {
        ...input,
        id: randomUUID(),
        version: 0,
        createdAt: now(),
        updatedAt: now(),
      };
      return upsert("Contacts", c, { Zip: c.zip, RegStatus: c.regStatus, ContactKey: c.contactKey });
    },
    async bulkCreateContacts(inputs: NewContact[]) {
      const out: Contact[] = [];
      for (const input of inputs) out.push(await this.createContact(input));
      return out;
    },
    async putContact(contact) {
      return upsert("Contacts", contact, {
        Zip: contact.zip,
        RegStatus: contact.regStatus,
        ContactKey: contact.contactKey,
      });
    },
    async appendContactLog(input: NewContactLog) {
      const log: ContactLog = { ...input, id: randomUUID(), createdAt: now() };
      return create("ContactLogs", log, { ContactId: log.contactId });
    },
    async logsForContact(contactId) {
      return (await listAll<ContactLog>("ContactLogs")).filter(
        (l) => l.contactId === contactId
      );
    },

    async appendAudit(evt: AuditEvent) {
      // Chain over the latest stored row so the Airtable log is tamper-evident
      // too. Reads the newest by Seq, then writes seq/prevHash/hash. (At
      // clerk-tool volume concurrent appends are rare; a fork would be caught by
      // /audit/verify. Seq + Hash are columns so the read can sort/inspect.)
      const latest = await req<{ records: AirtableRecord<AuditEvent>[] }>(
        "GET",
        "Audit?sort%5B0%5D%5Bfield%5D=Seq&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=1"
      );
      const prev = latest.records[0]
        ? (JSON.parse(latest.records[0].fields.Data) as AuditEvent)
        : null;
      const seq = (prev?.seq ?? 0) + 1;
      const withSeq: AuditEvent = { ...evt, seq };
      const hash = computeAuditHash(prev?.hash ?? null, withSeq);
      const chained: AuditEvent = { ...withSeq, prevHash: prev?.hash ?? null, hash };
      await create("Audit", chained, { Action: evt.action, Seq: seq, Hash: hash });
    },
    async readAudit() {
      const all = await listAll<AuditEvent>("Audit");
      return all.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    },
  };

  return store;
}
