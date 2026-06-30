import { Router } from "express";
import type { Request } from "express";
import { requireScope, requireAnyScope } from "../auth.js";
import {
  addOptOut,
  approveTemplate,
  createTemplate,
  sendFromTemplate,
  sendToContact,
} from "../lib/comms.js";
import { getStore } from "../lib/store.js";
import { getConfig } from "../config.js";
import { verifyStepUp } from "../lib/identity.js";
import { canSendSms, recordSmsSent } from "../lib/smsBudget.js";
import { rateAllow } from "../lib/ratelimit.js";
import type { CommsChannel, MessageTemplate, TemplateCategory } from "../lib/types.js";

export const commsRouter = Router();

const CATEGORIES: TemplateCategory[] = ["register", "plan", "turnout"];
const CHANNELS: CommsChannel[] = ["email", "sms", "social"];

// idempotencyKey is client-supplied and is later used in an Airtable
// filterByFormula lookup; constrain it to a safe charset (no quotes/control
// chars) so it can never break out of the formula literal.
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:@+-]{1,200}$/;

interface GuardFail {
  status: number;
  error: string;
}

/**
 * Layered safeguard for SMS-channel sends. Returns null if allowed, or a
 * {status,error} to reject. Order: kill switch / budget -> admin scope ->
 * step-up re-auth -> per-clerk rate limit.
 */
async function smsGuard(
  req: Request,
  template: MessageTemplate | undefined
): Promise<GuardFail | null> {
  if (!template || template.channel !== "sms") return null;

  const budget = await canSendSms();
  if (!budget.ok) {
    return { status: budget.reason === "sms_disabled" ? 503 : 429, error: budget.reason! };
  }
  if (!req.clerk!.scopes.includes("sms.send")) {
    return { status: 403, error: "sms_admin_only" };
  }
  const secret = await getConfig("JWT_SECRET");
  if (!secret || !verifyStepUp(req.header("x-stepup-token"), req.clerk!.clerkId, secret)) {
    return { status: 401, error: "step_up_required" };
  }
  if (!(await rateAllow(`sms:${req.clerk!.clerkId}`, 30, 60_000))) {
    return { status: 429, error: "rate_limited" };
  }
  return null;
}

// GET /comms/templates — any comms role may list (for drafting/review/sending).
commsRouter.get(
  "/templates",
  requireAnyScope(["comms.draft", "comms.approve", "comms.send"]),
  async (_req, res) => {
    const store = await getStore();
    res.json(await store.listTemplates());
  }
);

// POST /comms/templates — draft a template (Social/Comms clerk).
commsRouter.post("/templates", requireScope("comms.draft"), async (req, res) => {
  const b = req.body ?? {};
  if (!b.body || !CATEGORIES.includes(b.category) || !CHANNELS.includes(b.channel)) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }
  const t = await createTemplate(
    {
      category: b.category,
      channel: b.channel,
      subject: b.subject ?? null,
      body: String(b.body),
      hasDisclaimer: false, // derived in createTemplate
      hasOptOut: false,
      createdBy: req.clerk!.clerkId,
    },
    req.clerk!.clerkId
  );
  res.status(201).json(t);
});

// POST /comms/templates/:id/approve  { approve: boolean }
commsRouter.post(
  "/templates/:id/approve",
  requireScope("comms.approve"),
  async (req, res) => {
    const approve = req.body?.approve !== false; // default true
    const result = await approveTemplate(req.params.id, approve, req.clerk!.clerkId);
    if (result.ok) {
      res.json(result.template);
      return;
    }
    const status = result.code === "not_found" ? 404 : 409;
    res.status(status).json({ error: result.code });
  }
);

// POST /comms/send  { templateId, recipient, idempotencyKey }
commsRouter.post("/send", requireScope("comms.send"), async (req, res) => {
  const b = req.body ?? {};
  if (!b.templateId || !b.recipient || !b.idempotencyKey) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }
  if (!IDEMPOTENCY_KEY_RE.test(String(b.idempotencyKey))) {
    res.status(400).json({ error: "invalid_idempotency_key" });
    return;
  }
  const store = await getStore();
  const template = await store.getTemplate(String(b.templateId));
  const guard = await smsGuard(req, template);
  if (guard) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const result = await sendFromTemplate(
    String(b.templateId),
    String(b.recipient),
    String(b.idempotencyKey),
    req.clerk!.clerkId
  );
  if (result.ok) {
    if (template?.channel === "sms") await recordSmsSent();
    res.json({ status: "sent", outbox: result.outbox });
    return;
  }
  const status = result.code === "template_not_found" ? 404 : 409;
  res.status(status).json({ error: result.code, outbox: result.outbox });
});

// POST /comms/send-to-contact  { templateId, contactId, idempotencyKey }
// comms.send (any category) OR comms.send_registration (register category only).
commsRouter.post(
  "/send-to-contact",
  requireAnyScope(["comms.send", "comms.send_registration"]),
  async (req, res) => {
    const b = req.body ?? {};
    if (!b.templateId || !b.contactId || !b.idempotencyKey) {
      res.status(400).json({ error: "missing_fields" });
      return;
    }
    if (!IDEMPOTENCY_KEY_RE.test(String(b.idempotencyKey))) {
      res.status(400).json({ error: "invalid_idempotency_key" });
      return;
    }
    // Registration-only clerks may send register-category templates only.
    const store = await getStore();
    const t = await store.getTemplate(String(b.templateId));
    if (!req.clerk!.scopes.includes("comms.send")) {
      if (t && t.category !== "register") {
        res.status(403).json({ error: "forbidden_category" });
        return;
      }
    }
    // SMS sends face the full admin/step-up/budget/rate guard.
    const guard = await smsGuard(req, t);
    if (guard) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }
    const result = await sendToContact(
      String(b.templateId),
      String(b.contactId),
      String(b.idempotencyKey),
      req.clerk!.clerkId
    );
    if (result.ok) {
      if (t?.channel === "sms") await recordSmsSent();
      res.json({ status: "sent", outbox: result.outbox });
      return;
    }
    const notFound =
      result.code === "template_not_found" || result.code === "contact_not_found";
    res.status(notFound ? 404 : 409).json({ error: result.code, outbox: result.outbox });
  }
);

// POST /comms/optout  { recipient }
commsRouter.post("/optout", requireScope("optout.manage"), async (req, res) => {
  const recipient = req.body?.recipient;
  if (!recipient) {
    res.status(400).json({ error: "missing_recipient" });
    return;
  }
  await addOptOut(String(recipient), req.clerk!.clerkId);
  res.status(201).json({ status: "opted_out" });
});
