// Airtable StorePort adapter (Phase 1). Activated by STORE_DRIVER=airtable with
// AIRTABLE_PAT + AIRTABLE_BASE_ID (default base appiuSYCexFUmGIOr) loaded from
// SSM SecureString / env. Never tested from this repo's sandbox; structurally
// complete and typechecked. Each record stores queryable fields plus a `Data`
// JSON blob holding the full typed object — pragmatic and drift-resistant.
//
// Expected tables (create in the base): Tasks, Events, Shifts, Templates,
// OptOut, Outbox, Audit. Each needs at least a `Data` long-text field; the
// extra columns below are for human-readable filtering in the Airtable UI.

import { getConfig } from "../config.js";
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
    if (!res.ok) throw new Error(`airtable_${res.status}`);
    return (await res.json()) as T;
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
      return (await listAll<Task>("Tasks")).find((t) => t.id === id);
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
      return (await listAll<CampaignEvent>("Events")).find((e) => e.id === id);
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
      return (await listAll<Shift>("Shifts")).find((s) => s.id === id);
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
      return (await listAll<MessageTemplate>("Templates")).find((t) => t.id === id);
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
      const all = await listAll<{ id: string; contactKey: string }>("OptOut");
      return all.some((o) => o.contactKey === contactKey);
    },
    async addOptOut(contactKey) {
      await create("OptOut", { id: randomUUID(), contactKey });
    },
    async getOutboxByKey(idempotencyKey) {
      return (await listAll<OutboxEntry>("Outbox")).find(
        (o) => o.idempotencyKey === idempotencyKey
      );
    },
    async appendOutbox(entry) {
      return create("Outbox", entry, { Status: entry.status });
    },

    async listContacts(filter: ContactFilter = {}) {
      return (await listAll<Contact>("Contacts")).filter((c) => {
        if (filter.zip && c.zip !== filter.zip) return false;
        if (filter.regStatus && c.regStatus !== filter.regStatus) return false;
        if (filter.assignedClerkId && c.assignedClerkId !== filter.assignedClerkId)
          return false;
        return true;
      });
    },
    async getContact(id) {
      return (await listAll<Contact>("Contacts")).find((c) => c.id === id);
    },
    async findContactByKey(contactKey) {
      return (await listAll<Contact>("Contacts")).find(
        (c) => c.contactKey === contactKey
      );
    },
    async createContact(input: NewContact) {
      const c: Contact = {
        ...input,
        id: randomUUID(),
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
      await create("Audit", evt, { Action: evt.action });
    },
    async readAudit() {
      return listAll<AuditEvent>("Audit");
    },
  };

  return store;
}
