// Comms pipeline (Phase 3). Templates are drafted, then a Compliance Clerk
// approves them, then sends are gated on EVERY guardrail before the mailer is
// ever called:
//   1. template approved (complianceApprovalId set)
//   2. disclaimer present ("Paid for by")
//   3. opt-out language present (email/sms)
//   4. phase matches the template category
//   5. recipient not opted out
//   6. idempotency: a repeated idempotencyKey returns the prior outbox entry
//
// Privacy: only an opaque contactKey is persisted (outbox + opt-out). The raw
// recipient address is used to send and then discarded.

import { randomUUID } from "node:crypto";
import { COMMITTEE_NAME } from "../config.js";
import { currentPhase } from "../phase.js";
import { audit, getStore } from "./store.js";
import { getMailer } from "./mailer.js";
import { getSms } from "./sms.js";
import { contactKeyFor } from "./keys.js";
import type {
  MessageTemplate,
  OutboxEntry,
  Phase,
  TemplateCategory,
} from "./types.js";
import type { NewTemplate } from "./store.js";

export { contactKeyFor };

const PHASE_FOR_CATEGORY: Record<TemplateCategory, Phase[]> = {
  register: ["PHASE_1_REGISTER"],
  plan: ["PHASE_2_PLAN", "PHASE_3_TURNOUT"],
  turnout: ["PHASE_3_TURNOUT"],
};

export async function createTemplate(
  input: NewTemplate,
  clerkId: string
): Promise<MessageTemplate> {
  const store = await getStore();
  // Derive the compliance flags from the body so approval is meaningful. The
  // disclaimer must carry BOTH the "Paid for by" phrase AND the exact registered
  // committee name — a bare "paid for by X" with the wrong/absent committee is a
  // reportable FEC defect, so a substring match on the phrase alone isn't enough.
  const hasDisclaimer =
    /paid for by/i.test(input.body) &&
    input.body.toLowerCase().includes(COMMITTEE_NAME.toLowerCase());
  const hasOptOut =
    input.channel === "social" || /\b(stop|unsubscribe|opt[- ]?out)\b/i.test(input.body);
  const t = await store.createTemplate({ ...input, hasDisclaimer, hasOptOut });
  await audit(store, clerkId, "template.create", "template", t.id);
  return t;
}

export interface ApproveResult {
  ok: boolean;
  code?: "not_found" | "missing_disclaimer" | "missing_optout";
  template?: MessageTemplate;
}

export async function approveTemplate(
  id: string,
  approve: boolean,
  clerkId: string
): Promise<ApproveResult> {
  const store = await getStore();
  const t = await store.getTemplate(id);
  if (!t) return { ok: false, code: "not_found" };
  if (approve) {
    if (!t.hasDisclaimer) return { ok: false, code: "missing_disclaimer" };
    if (!t.hasOptOut) return { ok: false, code: "missing_optout" };
  }
  const updated: MessageTemplate = {
    ...t,
    complianceApprovalId: approve ? `appr_${randomUUID().slice(0, 8)}` : null,
    updatedAt: new Date().toISOString(),
  };
  await store.putTemplate(updated);
  await audit(store, clerkId, approve ? "template.approve" : "template.reject", "template", id);
  return { ok: true, template: updated };
}

export async function addOptOut(recipient: string, clerkId: string): Promise<void> {
  const store = await getStore();
  const key = contactKeyFor(recipient);
  await store.addOptOut(key);
  await audit(store, clerkId, "optout.add", "optout", key);
}

export interface SendResult {
  ok: boolean;
  code?:
    | "template_not_found"
    | "not_approved"
    | "missing_disclaimer"
    | "missing_optout"
    | "phase_mismatch"
    | "opted_out"
    | "no_consent"
    | "send_failed";
  outbox?: OutboxEntry;
}

export async function sendFromTemplate(
  templateId: string,
  recipient: string,
  idempotencyKey: string,
  clerkId: string,
  now: Date = new Date(),
  opts: { smsConsent?: boolean } = {}
): Promise<SendResult> {
  const store = await getStore();

  // Idempotency first: replaying a key never double-sends.
  const prior = await store.getOutboxByKey(idempotencyKey);
  if (prior) return { ok: prior.status === "sent", outbox: prior };

  const t = await store.getTemplate(templateId);
  if (!t) return { ok: false, code: "template_not_found" };

  const key = contactKeyFor(recipient);
  const record = async (status: OutboxEntry["status"], reason: string | null) => {
    const entry: OutboxEntry = {
      id: randomUUID(),
      templateId,
      channel: t.channel,
      contactKey: key,
      idempotencyKey,
      status,
      reason,
      createdAt: now.toISOString(),
    };
    await store.appendOutbox(entry);
    await audit(store, clerkId, `send.${status}`, "send", entry.id);
    return entry;
  };

  // Guardrails — order matters; the cheapest/safest checks first.
  if (!t.complianceApprovalId)
    return { ok: false, code: "not_approved", outbox: await record("blocked", "not_approved") };
  if (!t.hasDisclaimer)
    return { ok: false, code: "missing_disclaimer", outbox: await record("blocked", "missing_disclaimer") };
  if (!t.hasOptOut)
    return { ok: false, code: "missing_optout", outbox: await record("blocked", "missing_optout") };
  if (!PHASE_FOR_CATEGORY[t.category].includes(currentPhase(now)))
    return { ok: false, code: "phase_mismatch", outbox: await record("blocked", "phase_mismatch") };
  if (await store.isOptedOut(key))
    return { ok: false, code: "opted_out", outbox: await record("blocked", "opted_out") };
  // SMS requires prior express consent (TCPA). Raw sends can't verify it; the
  // contact-aware path passes opts.smsConsent. Email/social are not gated here.
  if (t.channel === "sms" && !opts.smsConsent)
    return { ok: false, code: "no_consent", outbox: await record("blocked", "no_consent") };

  // All gates passed — send via the channel's transport.
  let result: { ok: boolean; providerId?: string };
  if (t.channel === "sms") {
    const sms = await getSms();
    result = await sms.send({ to: recipient, body: t.body });
  } else {
    const mailer = await getMailer();
    result = await mailer.send({ to: recipient, subject: t.subject, body: t.body });
  }
  if (!result.ok)
    return { ok: false, code: "send_failed", outbox: await record("failed", "provider_error") };

  return { ok: true, outbox: await record("sent", null) };
}

export interface SendToContactResult {
  ok: boolean;
  code?: SendResult["code"] | "contact_not_found" | "no_email" | "contact_opted_out";
  outbox?: OutboxEntry;
}

/**
 * Send a template to a stored contact. Resolves the recipient from the contact,
 * runs the same gated pipeline, and on a successful register-category send marks
 * the contact regStatus = "reg_link_sent" so the registration push is trackable.
 */
export async function sendToContact(
  templateId: string,
  contactId: string,
  idempotencyKey: string,
  clerkId: string,
  now: Date = new Date()
): Promise<SendToContactResult> {
  const store = await getStore();
  const contact = await store.getContact(contactId);
  if (!contact) return { ok: false, code: "contact_not_found" };
  if (contact.optOut) return { ok: false, code: "contact_opted_out" };

  const template = await store.getTemplate(templateId);
  // For email templates we need an email; SMS would need a phone + consentSms.
  const recipient =
    template?.channel === "sms" ? contact.phone : contact.email;
  if (!recipient) return { ok: false, code: "no_email" };

  const result = await sendFromTemplate(
    templateId,
    recipient,
    idempotencyKey,
    clerkId,
    now,
    { smsConsent: contact.consentSms }
  );

  if (result.ok && template?.category === "register") {
    await store.putContact({
      ...contact,
      regStatus: "reg_link_sent",
      updatedAt: now.toISOString(),
    });
  }
  return result;
}
