// Airtable StorePort adapter (Phase 1). Activated by STORE_DRIVER=airtable with
// AIRTABLE_PAT + AIRTABLE_BASE_ID (both required — no default base) loaded from
// SSM SecureString / env. Each record stores queryable fields plus a `Data`
// JSON blob holding the full typed object — pragmatic and drift-resistant.
//
// Expected tables (create in the base): Tasks, Events, Shifts, Templates,
// Contacts, ContactLogs, FollowUps, OptOut, Outbox, Audit, TeamMembers,
// SocialPosts, SocialBlasts. Each needs a `Data` long-text field. Point reads
// use filterByFormula on these single-line-text columns, so they must exist where
// used: `RecordId` (Tasks/Events/Shifts/Templates/Contacts/TeamMembers/SocialPosts/SocialBlasts),
// `ContactKey` (Contacts/OptOut), `IdempotencyKey` (Outbox). The remaining columns
// (Status, Zip, County, Category, RegStatus, Action, EventId) are for human-readable
// filtering in the Airtable UI. See docs/airtable-setup.md.

import { getConfig } from "../config.js";
import { fetchWithTimeout } from "./http.js";
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
  NewFollowUp,
  FollowUpFilter,
  NewTeamMember,
  TeamMemberFilter,
  NewSocialPost,
  SocialPostFilter,
  NewSocialBlast,
  SocialBlastFilter,
} from "./store.js";
import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  CampaignEvent,
  Contact,
  ContactLog,
  FollowUp,
  MessageTemplate,
  OutboxEntry,
  Shift,
  SocialBlast,
  SocialPost,
  Task,
  TeamMember,
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
  // No fallback base id: the old default pointed at a DIFFERENT campaign base
  // (the expenses base), so a missing AIRTABLE_BASE_ID would silently write
  // voter-contact data into the wrong base. Fail fast instead (/ready → 503).
  const baseId = await getConfig("AIRTABLE_BASE_ID");
  if (!pat) throw new Error("AIRTABLE_PAT not configured");
  if (!baseId) throw new Error("AIRTABLE_BASE_ID not configured");

  async function req<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await fetchWithTimeout(`${API}/${baseId}/${path}`, {
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
    async putShiftIfVersion(shift, expectedVersion) {
      // Airtable has no transactional compare-and-swap, so re-read the record
      // immediately before writing and bail if the version already moved. This
      // narrows the race window to the get→put gap rather than the whole
      // claim; it is not a hard guarantee under true simultaneity.
      const cur = await findOneByFormula<Shift>("Shifts", "RecordId", shift.id);
      if (!cur || cur.version !== expectedVersion) return null;
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

    async createFollowUp(input: NewFollowUp) {
      const f: FollowUp = {
        ...input,
        id: randomUUID(),
        status: "pending",
        createdAt: now(),
        updatedAt: now(),
      };
      return upsert("FollowUps", f, { ContactId: f.contactId, Status: f.status });
    },
    async listFollowUps(filter: FollowUpFilter = {}) {
      return (await listAll<FollowUp>("FollowUps"))
        .filter((f) => {
          if (filter.status && f.status !== filter.status) return false;
          if (filter.contactId && f.contactId !== filter.contactId) return false;
          if (filter.dueBefore && f.dueAt > filter.dueBefore) return false;
          return true;
        })
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    },
    async getFollowUp(id) {
      return findOneByFormula<FollowUp>("FollowUps", "RecordId", id);
    },
    async putFollowUp(followUp) {
      return upsert("FollowUps", followUp, {
        ContactId: followUp.contactId,
        Status: followUp.status,
      });
    },

    async listSocialPosts(filter: SocialPostFilter = {}) {
      return (await listAll<SocialPost>("SocialPosts"))
        .filter((p) => {
          if (filter.status && p.status !== filter.status) return false;
          if (filter.blastId && p.blastId !== filter.blastId) return false;
          if (filter.category && p.category !== filter.category) return false;
          if (filter.phase && !p.phases.includes(filter.phase)) return false;
          return true;
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getSocialPost(id) {
      return findOneByFormula<SocialPost>("SocialPosts", "RecordId", id);
    },
    async createSocialPost(input: NewSocialPost) {
      const p: SocialPost = {
        ...input,
        id: randomUUID(),
        complianceApprovalId: null,
        shareCount: 0,
        createdAt: now(),
        updatedAt: now(),
      };
      return upsert("SocialPosts", p, { Category: p.category, Status: p.status });
    },
    async putSocialPost(post) {
      return upsert("SocialPosts", post, { Category: post.category, Status: post.status });
    },
    async incrementShareCount(id) {
      // No transactional CAS in Airtable; re-read immediately before writing.
      // Narrows the race to the get→put gap (fine at clerk-tool volume).
      const cur = await findOneByFormula<SocialPost>("SocialPosts", "RecordId", id);
      if (!cur) return null;
      const updated: SocialPost = {
        ...cur,
        shareCount: cur.shareCount + 1,
        updatedAt: now(),
      };
      return upsert("SocialPosts", updated, {
        Category: updated.category,
        Status: updated.status,
      });
    },
    async listSocialBlasts(filter: SocialBlastFilter = {}) {
      return (await listAll<SocialBlast>("SocialBlasts"))
        .filter((b) => (filter.status ? b.status === filter.status : true))
        .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
    },
    async getSocialBlast(id) {
      return findOneByFormula<SocialBlast>("SocialBlasts", "RecordId", id);
    },
    async createSocialBlast(input: NewSocialBlast) {
      const b: SocialBlast = { ...input, id: randomUUID(), createdAt: now(), updatedAt: now() };
      return upsert("SocialBlasts", b, { Status: b.status });
    },
    async putSocialBlast(blast) {
      return upsert("SocialBlasts", blast, { Status: blast.status });
    },

    async listTeamMembers(filter: TeamMemberFilter = {}) {
      let all = await listAll<TeamMember>("TeamMembers");
      if (filter.captainClerkId)
        all = all.filter((m) => m.captainClerkId === filter.captainClerkId);
      if (filter.active !== undefined) all = all.filter((m) => m.active === filter.active);
      return all.sort((a, b) => a.displayName.localeCompare(b.displayName));
    },
    async getTeamMember(id) {
      return findOneByFormula<TeamMember>("TeamMembers", "RecordId", id);
    },
    async getTeamMemberByClerkId(clerkId) {
      return findOneByFormula<TeamMember>("TeamMembers", "ClerkId", clerkId);
    },
    async getTeamMemberByEmail(email) {
      const e = email.trim().toLowerCase();
      return (await listAll<TeamMember>("TeamMembers")).find(
        (m) => (m.email ?? "").toLowerCase() === e
      );
    },
    async createTeamMember(input: NewTeamMember) {
      const m: TeamMember = { ...input, id: randomUUID(), createdAt: now(), updatedAt: now() };
      return upsert("TeamMembers", m, {
        ClerkId: m.clerkId ?? "",
        CaptainClerkId: m.captainClerkId,
      });
    },
    async putTeamMember(member) {
      return upsert("TeamMembers", member, {
        ClerkId: member.clerkId ?? "",
        CaptainClerkId: member.captainClerkId,
      });
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
