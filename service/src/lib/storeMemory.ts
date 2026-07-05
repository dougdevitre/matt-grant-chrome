// In-memory StorePort adapter (default). Single-process Maps with seed data so
// the panel works out of the box. Versioned mutators model optimistic
// concurrency; a real datastore enforces it for real.

import { randomUUID } from "node:crypto";
import { contactKeyFor } from "./keys.js";
import { computeAuditHash } from "./auditChain.js";
import { seedSocialContent } from "./seedSocial.js";
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
import type {
  AuditEvent,
  CampaignEvent,
  Contact,
  ContactLog,
  FollowUp,
  MessageTemplate,
  OutboxEntry,
  Phase,
  Shift,
  SocialBlast,
  SocialPost,
  Task,
  TeamMember,
} from "./types.js";

function now(): string {
  return new Date().toISOString();
}

export function makeMemoryStore(): StorePort {
  const tasks = new Map<string, Task>();
  const events = new Map<string, CampaignEvent>();
  const shifts = new Map<string, Shift>();
  const templates = new Map<string, MessageTemplate>();
  const optOut = new Set<string>();
  const outbox = new Map<string, OutboxEntry>(); // keyed by idempotencyKey
  const contacts = new Map<string, Contact>();
  const contactsByKey = new Map<string, string>(); // contactKey -> contactId
  const contactLogs: ContactLog[] = [];
  const followUps = new Map<string, FollowUp>();
  const socialPosts = new Map<string, SocialPost>();
  const socialBlasts = new Map<string, SocialBlast>();
  const teamMembers = new Map<string, TeamMember>();
  const auditLog: AuditEvent[] = [];
  let lastAuditHash: string | null = null;
  let nextAuditSeq = 0;

  const store: StorePort = {
    async listTasks() {
      return [...tasks.values()];
    },
    async getTask(id) {
      return tasks.get(id);
    },
    async putTask(task) {
      tasks.set(task.id, task);
      return task;
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
      tasks.set(t.id, t);
      return t;
    },

    async listEvents() {
      return [...events.values()];
    },
    async getEvent(id) {
      return events.get(id);
    },
    async createEvent(input: NewEvent) {
      const e: CampaignEvent = { ...input, id: randomUUID(), createdAt: now() };
      events.set(e.id, e);
      return e;
    },

    async shiftsForEvent(eventId) {
      return [...shifts.values()].filter((s) => s.eventId === eventId);
    },
    async shiftsForClerk(clerkId) {
      return [...shifts.values()].filter((s) => s.claimedBy.includes(clerkId));
    },
    async getShift(id) {
      return shifts.get(id);
    },
    async putShift(shift) {
      shifts.set(shift.id, shift);
      return shift;
    },
    async putShiftIfVersion(shift, expectedVersion) {
      // Synchronous check+set (no await between them) is atomic on the single
      // event loop, so two interleaved claims can't both pass.
      const cur = shifts.get(shift.id);
      if (!cur || cur.version !== expectedVersion) return null;
      shifts.set(shift.id, shift);
      return shift;
    },
    async createShift(input: NewShift) {
      const s: Shift = { ...input, id: randomUUID(), claimedBy: [], version: 1 };
      shifts.set(s.id, s);
      return s;
    },

    async listTemplates() {
      return [...templates.values()];
    },
    async getTemplate(id) {
      return templates.get(id);
    },
    async createTemplate(input: NewTemplate) {
      const t: MessageTemplate = {
        ...input,
        id: randomUUID(),
        complianceApprovalId: null,
        createdAt: now(),
        updatedAt: now(),
      };
      templates.set(t.id, t);
      return t;
    },
    async putTemplate(template) {
      templates.set(template.id, template);
      return template;
    },
    async isOptedOut(contactKey) {
      return optOut.has(contactKey);
    },
    async addOptOut(contactKey) {
      optOut.add(contactKey);
    },
    async getOutboxByKey(idempotencyKey) {
      return outbox.get(idempotencyKey);
    },
    async appendOutbox(entry) {
      outbox.set(entry.idempotencyKey, entry);
      return entry;
    },

    async listContacts(filter: ContactFilter = {}) {
      return [...contacts.values()].filter((c) => {
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
      return contacts.get(id);
    },
    async findContactByKey(contactKey) {
      const id = contactsByKey.get(contactKey);
      return id ? contacts.get(id) : undefined;
    },
    async createContact(input: NewContact) {
      const c: Contact = { ...input, id: randomUUID(), version: 0, createdAt: now(), updatedAt: now() };
      contacts.set(c.id, c);
      if (c.contactKey) contactsByKey.set(c.contactKey, c.id);
      return c;
    },
    async bulkCreateContacts(inputs: NewContact[]) {
      const created: Contact[] = [];
      for (const input of inputs) {
        const c: Contact = { ...input, id: randomUUID(), version: 0, createdAt: now(), updatedAt: now() };
        contacts.set(c.id, c);
        if (c.contactKey) contactsByKey.set(c.contactKey, c.id);
        created.push(c);
      }
      return created;
    },
    async putContact(contact) {
      contacts.set(contact.id, contact);
      if (contact.contactKey) contactsByKey.set(contact.contactKey, contact.id);
      return contact;
    },
    async appendContactLog(input: NewContactLog) {
      const log: ContactLog = { ...input, id: randomUUID(), createdAt: now() };
      contactLogs.push(log);
      return log;
    },
    async logsForContact(contactId) {
      return contactLogs.filter((l) => l.contactId === contactId);
    },

    async createFollowUp(input: NewFollowUp) {
      const f: FollowUp = {
        ...input,
        id: randomUUID(),
        status: "pending",
        createdAt: now(),
        updatedAt: now(),
      };
      followUps.set(f.id, f);
      return f;
    },
    async listFollowUps(filter: FollowUpFilter = {}) {
      return [...followUps.values()]
        .filter((f) => {
          if (filter.status && f.status !== filter.status) return false;
          if (filter.contactId && f.contactId !== filter.contactId) return false;
          if (filter.dueBefore && f.dueAt > filter.dueBefore) return false;
          return true;
        })
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    },
    async getFollowUp(id) {
      return followUps.get(id);
    },
    async putFollowUp(followUp) {
      followUps.set(followUp.id, followUp);
      return followUp;
    },

    async listSocialPosts(filter: SocialPostFilter = {}) {
      return [...socialPosts.values()]
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
      return socialPosts.get(id);
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
      socialPosts.set(p.id, p);
      return p;
    },
    async putSocialPost(post) {
      socialPosts.set(post.id, post);
      return post;
    },
    async incrementShareCount(id) {
      // Synchronous read+write (no await between) is atomic on the single event
      // loop, so concurrent shares can't lose a count.
      const cur = socialPosts.get(id);
      if (!cur) return null;
      const updated: SocialPost = {
        ...cur,
        shareCount: cur.shareCount + 1,
        updatedAt: now(),
      };
      socialPosts.set(id, updated);
      return updated;
    },
    async listSocialBlasts(filter: SocialBlastFilter = {}) {
      return [...socialBlasts.values()]
        .filter((b) => (filter.status ? b.status === filter.status : true))
        .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
    },
    async getSocialBlast(id) {
      return socialBlasts.get(id);
    },
    async createSocialBlast(input: NewSocialBlast) {
      const b: SocialBlast = { ...input, id: randomUUID(), createdAt: now(), updatedAt: now() };
      socialBlasts.set(b.id, b);
      return b;
    },
    async putSocialBlast(blast) {
      socialBlasts.set(blast.id, blast);
      return blast;
    },

    async listTeamMembers(filter: TeamMemberFilter = {}) {
      return [...teamMembers.values()]
        .filter((m) => {
          if (filter.captainClerkId && m.captainClerkId !== filter.captainClerkId) return false;
          if (filter.active !== undefined && m.active !== filter.active) return false;
          return true;
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    },
    async getTeamMember(id) {
      return teamMembers.get(id);
    },
    async getTeamMemberByClerkId(clerkId) {
      return [...teamMembers.values()].find((m) => m.clerkId === clerkId);
    },
    async getTeamMemberByEmail(email) {
      const e = email.trim().toLowerCase();
      return [...teamMembers.values()].find((m) => (m.email ?? "").toLowerCase() === e);
    },
    async createTeamMember(input: NewTeamMember) {
      const m: TeamMember = { ...input, id: randomUUID(), createdAt: now(), updatedAt: now() };
      teamMembers.set(m.id, m);
      return m;
    },
    async putTeamMember(member) {
      teamMembers.set(member.id, member);
      return member;
    },

    async appendAudit(evt) {
      // Tamper-evident chain: each entry's hash covers its content + the prior
      // hash, so any later edit/deletion/reorder breaks the chain on verification.
      const prevHash = lastAuditHash;
      const withSeq: AuditEvent = { ...evt, seq: nextAuditSeq++ };
      const hash = computeAuditHash(prevHash, withSeq);
      lastAuditHash = hash;
      auditLog.push({ ...withSeq, prevHash, hash });
    },
    async readAudit() {
      return [...auditLog];
    },
  };

  seedReady = seed(store);
  return store;
}

// Resolves once the seed data has been written. `getStore()` awaits this so the
// first request (and every test) sees a fully-seeded store rather than racing
// the fire-and-forget seed.
export let seedReady: Promise<void> = Promise.resolve();

const ALL_PHASES: Phase[] = ["PHASE_1_REGISTER", "PHASE_2_PLAN", "PHASE_3_TURNOUT"];

async function seed(store: StorePort): Promise<void> {
  {
    await store.createTask({
      kind: "register_contact",
      title: "Send registration link to 12 contacts in 63031",
      detail: "Florissant new movers flagged unregistered. Deadline Jul 8.",
      requiresScope: "voter.write",
      phases: ["PHASE_1_REGISTER"],
      priority: 90,
      dueAt: "2026-07-08T17:00:00-05:00",
      zip: "63031",
    });
    await store.createTask({
      kind: "call",
      title: "Call back 8 supporters who missed the first attempt",
      detail: "Use the phase-correct script in the side panel.",
      requiresScope: "contact.log",
      phases: ALL_PHASES,
      priority: 60,
      dueAt: null,
      zip: "63031",
    });
    await store.createTask({
      kind: "approve_template",
      title: "Review GOTV text template for disclaimer + opt-out",
      detail: "Confirm 'Paid for by' line and STOP language before release.",
      requiresScope: "comms.approve",
      phases: ALL_PHASES,
      priority: 80,
      dueAt: null,
      zip: null,
    });
    await store.createTask({
      kind: "import_list",
      title: "Clean & dedupe the St. Louis County volunteer CSV",
      detail: "Geocode, flag out-of-MO-02 rows, dedupe against existing.",
      requiresScope: "list.import",
      phases: ALL_PHASES,
      priority: 50,
      dueAt: null,
      zip: null,
    });

    const drive = await store.createEvent({
      title: "Florissant Library Registration Drive",
      kind: "registration_drive",
      county: "St. Louis",
      zip: "63031",
      venueName: "Florissant Valley Branch Library",
      startsAt: "2026-07-02T10:00:00-05:00",
      endsAt: "2026-07-02T14:00:00-05:00",
      phases: ["PHASE_1_REGISTER"],
      createdBy: "seed",
    });
    await store.createShift({
      eventId: drive.id,
      role: "Table captain",
      startsAt: "2026-07-02T10:00:00-05:00",
      endsAt: "2026-07-02T12:00:00-05:00",
      capacity: 2,
    });
    await store.createShift({
      eventId: drive.id,
      role: "Greeter",
      startsAt: "2026-07-02T12:00:00-05:00",
      endsAt: "2026-07-02T14:00:00-05:00",
      capacity: 3,
    });

    await store.createContact({
      firstName: "Jordan",
      lastName: "Pierce",
      phone: null,
      email: "jordan.pierce@example.com",
      addressLine1: "123 Elm St",
      city: "Florissant",
      zip: "63031",
      inDistrict: true,
      censusBlock: null,
      regStatus: "unregistered",
      voteStatus: "unknown",
      voteMethod: null,
      votedAt: null,
      votePlan: null,
      consentSms: false,
      consentEmail: false,
      consentSource: null,
      consentAt: null,
      optOut: false,
      tags: ["new_mover"],
      assignedClerkId: null,
      contactKey: contactKeyFor("jordan.pierce@example.com"),
      source: "seed",
    });
    await store.createContact({
      firstName: "Avery",
      lastName: "Nguyen",
      phone: "+13145550199",
      email: null,
      addressLine1: null,
      city: "Florissant",
      zip: "63031",
      inDistrict: null,
      censusBlock: null,
      regStatus: "registered",
      voteStatus: "early_voted",
      voteMethod: "early_in_person",
      votedAt: "2026-06-28T10:00:00-05:00",
      votePlan: null,
      consentSms: true,
      consentEmail: false,
      consentSource: "seed",
      consentAt: "2026-06-20T00:00:00-05:00",
      optOut: false,
      tags: [],
      assignedClerkId: null,
      contactKey: contactKeyFor("+13145550199"),
      source: "seed",
    });

    // GOTV turnout scripts, ready for a Compliance Clerk to review + approve
    // (complianceApprovalId stays null until then, so they can't be sent yet).
    await store.createTemplate({
      category: "turnout",
      channel: "sms",
      subject: null,
      body:
        "Hi {{first}}, it's the Matt Grant for Congress team. Can we count on you to " +
        "vote in the Aug 4 primary? Reply YES to pledge. Paid for by Matt Grant for " +
        "Congress. Reply STOP to opt out.",
      hasDisclaimer: true,
      hasOptOut: true,
      createdBy: "seed",
    });
    await store.createTemplate({
      category: "turnout",
      channel: "sms",
      subject: null,
      body:
        "{{first}}, early voting is underway. Make a plan to vote before Aug 4 — your " +
        "day, time, and polling place. Look yours up at sos.mo.gov. Paid for by Matt " +
        "Grant for Congress. Reply STOP to opt out.",
      hasDisclaimer: true,
      hasOptOut: true,
      createdBy: "seed",
    });
    await store.createTemplate({
      category: "turnout",
      channel: "sms",
      subject: null,
      body:
        "Today's the day, {{first}}! Polls are open until 7pm for the Aug 4 primary. " +
        "Bring a photo ID and make your voice heard. Paid for by Matt Grant for " +
        "Congress. Reply STOP to opt out.",
      hasDisclaimer: true,
      hasOptOut: true,
      createdBy: "seed",
    });

    // Social amplification blasts + approved posts (shared with the Airtable
    // seed script via one source of truth).
    await seedSocialContent(store);
  }
}
