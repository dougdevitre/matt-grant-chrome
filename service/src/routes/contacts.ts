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

// Each import row triggers a geocode lookup, so cap rows to bound the outbound
// work a single request can drive.
const MAX_IMPORT_ROWS = 5000;

/** Returns an error response object if the CSV is unusable, else null. */
function csvError(csv: unknown): { status: number; error: string } | null {
  if (typeof csv !== "string" || !csv.trim()) return { status: 400, error: "missing_csv" };
  const lines = csv.split(/\r\n|\r|\n/).filter((l) => l.trim()).length;
  if (lines - 1 > MAX_IMPORT_ROWS) return { status: 413, error: "too_many_rows" };
  return null;
}

// POST /contacts/import/preview  { csv }
contactsRouter.post("/import/preview", requireScope("list.import"), async (req, res) => {
  const err = csvError(req.body?.csv);
  if (err) {
    res.status(err.status).json({ error: err.error });
    return;
  }
  res.json(await previewImport(req.body.csv));
});

// POST /contacts/import/commit  { csv }
contactsRouter.post("/import/commit", requireScope("list.import"), async (req, res) => {
  const err = csvError(req.body?.csv);
  if (err) {
    res.status(err.status).json({ error: err.error });
    return;
  }
  res.status(201).json(await commitImport(req.body.csv, req.clerk!.clerkId));
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
