import { Router } from "express";
import type { Response } from "express";
import { requireScope, requirePhaseWritable } from "../auth.js";
import {
  addOneContact,
  commitImport,
  logDisposition,
  optOutContact,
  previewImport,
  recordConsent,
  setVotePlan,
} from "../lib/contacts.js";
import { scheduleFollowUp } from "../lib/followups.js";
import { leaForCounty } from "../lib/publicData.js";
import { getStore } from "../lib/store.js";
import { pathParam, queryStr } from "../lib/http.js";
import { parsePageParams, applyPage } from "../lib/pagination.js";
import type {
  ContactDisposition,
  RegStatus,
  VoteMethod,
  VoteStatus,
} from "../lib/types.js";

const VOTE_METHODS: VoteMethod[] = ["early_in_person", "absentee", "election_day"];
const MO_VOTER_LOOKUP = "https://s1.sos.mo.gov/elections/voterlookup/";

export const contactsRouter = Router();

const DISPOSITIONS: ContactDisposition[] = [
  "not_home",
  "supportive",
  "undecided",
  "opposed",
  "registered",
  "opted_out",
  "pledged_to_vote",
  "voted_early",
  "voted_absentee",
  "voted_election_day",
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
contactsRouter.post("/import/commit", requireScope("list.import"), requirePhaseWritable, async (req, res) => {
  const err = csvError(req.body?.csv);
  if (err) {
    res.status(err.status).json({ error: err.error });
    return;
  }
  res.status(201).json(await commitImport(req.body.csv, req.clerk!.clerkId));
});

// POST /contacts  { firstName, lastName, phone?, email?, address?, city?, zip? }
// Add a single contact (a clerk on a call) through the same normalize → dedupe →
// suppress-opt-outs → geocode path as an import.
contactsRouter.post("/", requireScope("list.import"), requirePhaseWritable, async (req, res) => {
  const b = req.body ?? {};
  const result = await addOneContact(
    {
      firstName: typeof b.firstName === "string" ? b.firstName : "",
      lastName: typeof b.lastName === "string" ? b.lastName : "",
      phone: typeof b.phone === "string" ? b.phone : undefined,
      email: typeof b.email === "string" ? b.email : undefined,
      addressLine1: typeof b.address === "string" ? b.address : undefined,
      city: typeof b.city === "string" ? b.city : undefined,
      zip: typeof b.zip === "string" ? b.zip : undefined,
    },
    req.clerk!.clerkId
  );
  if (result.ok) {
    res.status(201).json(result.contact);
    return;
  }
  // invalid → 400 (fixable input); duplicate / suppressed → 409 (already known).
  res.status(result.code === "invalid" ? 400 : 409).json({
    error: result.code,
    reason: result.reason,
  });
});

// GET /contacts?zip=&regStatus=&voteStatus=&notVoted=&limit=&offset=
contactsRouter.get("/", requireScope("voter.read"), async (req, res) => {
  const store = await getStore();
  const zip = queryStr(req, "zip");
  const rs = queryStr(req, "regStatus");
  const regStatus = rs ? (rs as RegStatus) : null;
  const vs = queryStr(req, "voteStatus");
  const voteStatus = vs ? (vs as VoteStatus) : null;
  const notVoted = queryStr(req, "notVoted") === "true";
  const all = await store.listContacts({ zip, regStatus, voteStatus, notVoted });
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
contactsRouter.post("/:id/logs", requireScope("contact.log"), requirePhaseWritable, async (req, res) => {
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
contactsRouter.post("/:id/consent", requireScope("contact.log"), requirePhaseWritable, async (req, res) => {
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

// POST /contacts/:id/vote-plan  { method?, date?, time?, needsRide?, note?, version? }
contactsRouter.post("/:id/vote-plan", requireScope("contact.log"), requirePhaseWritable, async (req, res) => {
  const b = req.body ?? {};
  if (b.method != null && !VOTE_METHODS.includes(b.method)) {
    res.status(400).json({ error: "invalid_method" });
    return;
  }
  const expectedVersion = typeof b.version === "number" ? b.version : undefined;
  const result = await setVotePlan(
    pathParam(req, "id"),
    req.clerk!.clerkId,
    {
      method: b.method ?? null,
      date: typeof b.date === "string" ? b.date : null,
      time: typeof b.time === "string" ? b.time : null,
      needsRide: b.needsRide === true,
      note: typeof b.note === "string" ? b.note : null,
    },
    expectedVersion
  );
  if (!result.ok) {
    sendContactWriteError(res, result.code);
    return;
  }
  res.status(201).json({ status: "vote_plan_saved" });
});

// GET /contacts/:id/polling-place — the contact's local election authority +
// the official MO lookup (no precinct-level API exists, so this surfaces the
// authoritative place to check rather than inventing a polling location).
contactsRouter.get("/:id/polling-place", requireScope("voter.read"), async (req, res) => {
  const store = await getStore();
  const contact = await store.getContact(pathParam(req, "id"));
  if (!contact) {
    res.status(404).json({ error: "contact_not_found" });
    return;
  }
  const address = [contact.addressLine1, contact.city, contact.zip]
    .filter(Boolean)
    .join(", ");
  // Best-effort jurisdiction hint from the contact's city (resolveLea always
  // returns a usable county-clerk record + the SOS lookup for unknown inputs).
  const lea = await leaForCounty(contact.city ?? "");
  res.json({ address: address || null, lea, lookupUrl: MO_VOTER_LOOKUP });
});

// POST /contacts/:id/followups  { templateId?, dueAt, note? } — schedule a GOTV
// follow-up reminder (surfaced to a clerk when due; not auto-sent).
contactsRouter.post("/:id/followups", requireScope("contact.log"), requirePhaseWritable, async (req, res) => {
  const b = req.body ?? {};
  const dueAt = typeof b.dueAt === "string" ? b.dueAt : null;
  if (!dueAt || Number.isNaN(Date.parse(dueAt))) {
    res.status(400).json({ error: "invalid_dueAt" });
    return;
  }
  const followUp = await scheduleFollowUp({
    contactId: pathParam(req, "id"),
    clerkId: req.clerk!.clerkId,
    templateId: typeof b.templateId === "string" ? b.templateId : null,
    dueAt,
    note: typeof b.note === "string" ? b.note : null,
  });
  if (!followUp) {
    res.status(404).json({ error: "contact_not_found" });
    return;
  }
  res.status(201).json(followUp);
});
