import { Router } from "express";
import { requireScope } from "../auth.js";
import {
  commitImport,
  logDisposition,
  optOutContact,
  previewImport,
  recordConsent,
} from "../lib/contacts.js";
import { getStore } from "../lib/store.js";
import type { ContactDisposition, RegStatus } from "../lib/types.js";

export const contactsRouter = Router();

const DISPOSITIONS: ContactDisposition[] = [
  "not_home",
  "supportive",
  "undecided",
  "opposed",
  "registered",
  "opted_out",
];

// POST /contacts/import/preview  { csv }
contactsRouter.post("/import/preview", requireScope("list.import"), async (req, res) => {
  const csv = req.body?.csv;
  if (typeof csv !== "string" || !csv.trim()) {
    res.status(400).json({ error: "missing_csv" });
    return;
  }
  res.json(await previewImport(csv));
});

// POST /contacts/import/commit  { csv }
contactsRouter.post("/import/commit", requireScope("list.import"), async (req, res) => {
  const csv = req.body?.csv;
  if (typeof csv !== "string" || !csv.trim()) {
    res.status(400).json({ error: "missing_csv" });
    return;
  }
  res.status(201).json(await commitImport(csv, req.clerk!.clerkId));
});

// GET /contacts?zip=&regStatus=
contactsRouter.get("/", requireScope("voter.read"), async (req, res) => {
  const store = await getStore();
  const zip = typeof req.query.zip === "string" ? req.query.zip : null;
  const regStatus =
    typeof req.query.regStatus === "string"
      ? (req.query.regStatus as RegStatus)
      : null;
  res.json(await store.listContacts({ zip, regStatus }));
});

// GET /contacts/:id
contactsRouter.get("/:id", requireScope("voter.read"), async (req, res) => {
  const store = await getStore();
  const contact = await store.getContact(req.params.id);
  if (!contact) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const logs = await store.logsForContact(contact.id);
  res.json({ ...contact, logs });
});

// POST /contacts/:id/logs  { channel, disposition, note? }
contactsRouter.post("/:id/logs", requireScope("contact.log"), async (req, res) => {
  const b = req.body ?? {};
  if (!DISPOSITIONS.includes(b.disposition)) {
    res.status(400).json({ error: "invalid_disposition" });
    return;
  }
  const channel = ["call", "text", "door", "email"].includes(b.channel)
    ? b.channel
    : "call";
  const log = await logDisposition(
    req.params.id,
    req.clerk!.clerkId,
    channel,
    b.disposition,
    typeof b.note === "string" ? b.note : null
  );
  if (!log) {
    res.status(404).json({ error: "contact_not_found" });
    return;
  }
  res.status(201).json(log);
});

// POST /contacts/:id/optout
contactsRouter.post("/:id/optout", requireScope("optout.manage"), async (req, res) => {
  const ok = await optOutContact(req.params.id, req.clerk!.clerkId);
  if (!ok) {
    res.status(404).json({ error: "contact_not_found" });
    return;
  }
  res.status(201).json({ status: "opted_out" });
});

// POST /contacts/:id/consent  { channel: "sms"|"email", consented: boolean, note? }
contactsRouter.post("/:id/consent", requireScope("contact.log"), async (req, res) => {
  const b = req.body ?? {};
  if (b.channel !== "sms" && b.channel !== "email") {
    res.status(400).json({ error: "invalid_channel" });
    return;
  }
  const ok = await recordConsent(
    req.params.id,
    b.channel,
    b.consented !== false,
    req.clerk!.clerkId,
    typeof b.note === "string" ? b.note : null
  );
  if (!ok) {
    res.status(404).json({ error: "contact_not_found" });
    return;
  }
  res.status(201).json({ status: "consent_recorded" });
});
