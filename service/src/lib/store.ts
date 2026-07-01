// Storage abstraction (Phase 1). One async port; two adapters. Default is the
// in-memory store so the repo runs with no credentials. Set STORE_DRIVER=airtable
// (plus AIRTABLE_PAT + AIRTABLE_BASE_ID in SSM/env) to persist to Airtable.

import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  CampaignEvent,
  Contact,
  ContactLog,
  MessageTemplate,
  FollowUp,
  OutboxEntry,
  RegStatus,
  Shift,
  Task,
  VoteStatus,
} from "./types.js";

export type NewTask = Omit<
  Task,
  "id" | "status" | "assignedClerkId" | "skipReason" | "version" | "createdAt" | "updatedAt"
>;
export type NewEvent = Omit<CampaignEvent, "id" | "createdAt">;
export type NewShift = Omit<Shift, "id" | "claimedBy" | "version">;
export type NewTemplate = Omit<
  MessageTemplate,
  "id" | "complianceApprovalId" | "createdAt" | "updatedAt"
>;
export type NewContact = Omit<Contact, "id" | "version" | "createdAt" | "updatedAt">;
export type NewContactLog = Omit<ContactLog, "id" | "createdAt">;

export interface ContactFilter {
  zip?: string | null;
  regStatus?: RegStatus | null;
  voteStatus?: VoteStatus | null;
  /** GOTV: keep only contacts not yet recorded as "voted" (the turnout queue). */
  notVoted?: boolean;
  assignedClerkId?: string | null;
}

export type NewFollowUp = Omit<FollowUp, "id" | "status" | "createdAt" | "updatedAt">;

export interface FollowUpFilter {
  status?: FollowUp["status"] | null;
  contactId?: string | null;
  /** Only reminders due at/before this ISO instant (the "due now" queue). */
  dueBefore?: string | null;
}

export interface StorePort {
  // tasks
  listTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  putTask(task: Task): Promise<Task>;
  createTask(input: NewTask): Promise<Task>;
  // events
  listEvents(): Promise<CampaignEvent[]>;
  getEvent(id: string): Promise<CampaignEvent | undefined>;
  createEvent(input: NewEvent): Promise<CampaignEvent>;
  // shifts
  shiftsForEvent(eventId: string): Promise<Shift[]>;
  shiftsForClerk(clerkId: string): Promise<Shift[]>;
  getShift(id: string): Promise<Shift | undefined>;
  putShift(shift: Shift): Promise<Shift>;
  createShift(input: NewShift): Promise<Shift>;
  // comms
  listTemplates(): Promise<MessageTemplate[]>;
  getTemplate(id: string): Promise<MessageTemplate | undefined>;
  createTemplate(input: NewTemplate): Promise<MessageTemplate>;
  putTemplate(template: MessageTemplate): Promise<MessageTemplate>;
  isOptedOut(contactKey: string): Promise<boolean>;
  addOptOut(contactKey: string): Promise<void>;
  getOutboxByKey(idempotencyKey: string): Promise<OutboxEntry | undefined>;
  appendOutbox(entry: OutboxEntry): Promise<OutboxEntry>;
  // contacts
  listContacts(filter?: ContactFilter): Promise<Contact[]>;
  getContact(id: string): Promise<Contact | undefined>;
  findContactByKey(contactKey: string): Promise<Contact | undefined>;
  createContact(input: NewContact): Promise<Contact>;
  bulkCreateContacts(inputs: NewContact[]): Promise<Contact[]>;
  putContact(contact: Contact): Promise<Contact>;
  appendContactLog(log: NewContactLog): Promise<ContactLog>;
  logsForContact(contactId: string): Promise<ContactLog[]>;
  // follow-up reminders (GOTV)
  createFollowUp(input: NewFollowUp): Promise<FollowUp>;
  listFollowUps(filter?: FollowUpFilter): Promise<FollowUp[]>;
  getFollowUp(id: string): Promise<FollowUp | undefined>;
  putFollowUp(followUp: FollowUp): Promise<FollowUp>;
  // audit
  appendAudit(evt: AuditEvent): Promise<void>;
  readAudit(): Promise<AuditEvent[]>;
}

/** Build an AuditEvent and append it. Shared helper for all domain logic. */
export async function audit(
  store: StorePort,
  clerkId: string,
  action: string,
  entity: AuditEvent["entity"],
  entityId: string
): Promise<void> {
  await store.appendAudit({
    id: randomUUID(),
    ts: new Date().toISOString(),
    clerkId,
    action,
    entity,
    entityId,
  });
}

let singleton: StorePort | null = null;

/** Lazily construct the configured store. Memory unless STORE_DRIVER=airtable. */
export async function getStore(): Promise<StorePort> {
  if (singleton) return singleton;
  const driver = process.env.STORE_DRIVER ?? "memory";
  if (driver === "airtable") {
    const { makeAirtableStore } = await import("./storeAirtable.js");
    singleton = await makeAirtableStore();
  } else {
    const mod = await import("./storeMemory.js");
    singleton = mod.makeMemoryStore();
    // Seeding is async; await it so the first caller sees a fully-seeded store.
    await mod.seedReady;
  }
  return singleton;
}

/**
 * Test-only: drop the cached store so the next getStore() rebuilds a fresh,
 * re-seeded in-memory store. Lets each test file start from a clean slate.
 */
export function resetStoreForTests(): void {
  singleton = null;
}
