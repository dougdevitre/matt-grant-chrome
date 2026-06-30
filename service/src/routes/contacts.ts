import { Router } from "express";
import type { Response } from "express";
import { requireScope } from "../auth.js";
import {
  commitImport,
  logDisposition,
  optOutContact,
  previewImport,
  recordConsent,
} from "../lib/contacts.js";
import { getStore } from "../lib/store.js";
import { pathParam, queryStr } from "../lib/http.js";
import { parsePageParams, applyPage } from "../lib/pagination.js";
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

// GET /contacts?zip=&regStatus=&limit=&offset=
contactsRouter.get("/", requireScope("voter.read"), async (req, res) => {
  const store = await getStore();
  const zip = queryStr(req, "zip");
  const rs = queryStr(req, "regStatus");
  const regStatus = rs ? (rs as RegStatus) : null;
  const all = await store.listContacts({ zip, regStatus });
  res.setHeader("X-Total-Count", String(all.length));
  res.json(applyPage(all, parsePageParams(req)));
});

// GET /contacts/:id
contactsRouter.get("/:id", requireScope("voter.read"), async (req, res) => {
  const store = await getStore();
  const contact = await store.getContact(pathParam(req, "id"));
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
    pathParam(req, "id"),
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

// Map a versioned-write failure to an HTTP response (404 or 409 conflict).
function sendContactWriteError(
  res: Response,
  code: "not_found" | "version_conflict"
): void {
  if (code === "not_found") {
    res.status(404).json({ error: "contact_not_found" });
  } else {
    res.status(409).json({ error: "version_conflict" });
  }
}

// POST /contacts/:id/optout  { version? }
contactsRouter.post("/:id/optout", requireScope("optout.manage"), async (req, res) => {
  const expectedVersion =
    typeof req.body?.version === "number" ? req.body.version : undefined;
  const result = await optOutContact(pathParam(req, "id"), req.clerk!.clerkId, expectedVersion);
  if (!result.ok) {
    sendContactWriteError(res, result.code);
    return;
  }
  res.status(201).json({ status: "opted_out" });
});

// POST /contacts/:id/consent  { channel: "sms"|"email", consented: boolean, note?, version? }
contactsRouter.post("/:id/consent", requireScope("contact.log"), async (req, res) => {
  const b = req.body ?? {};
  if (b.channel !== "sms" && b.channel !== "email") {
    res.status(400).json({ error: "invalid_channel" });
    return;
  }
  const expectedVersion = typeof b.version === "number" ? b.version : undefined;
  const result = await recordConsent(
    pathParam(req, "id"),
    b.channel,
    b.consented !== false,
    req.clerk!.clerkId,
    typeof b.note === "string" ? b.note : null,
    expectedVersion
  );
  if (!result.ok) {
    sendContactWriteError(res, result.code);
    return;
  }
  res.status(201).json({ status: "consent_recorded" });
});
