// Contacts layer. Imports a CSV, normalizes + validates rows, geocodes for the
// in-district check, dedupes against existing contacts by opaque key, and stages
// a preview before commit. This is the data foundation tasks + comms act on.

import { audit, getStore } from "./store.js";
import { contactKeyFor } from "./keys.js";
import { geocodeAddress } from "./publicData.js";
import type {
  Contact,
  ContactDisposition,
  ContactLog,
  ImportPreview,
  ImportResult,
  ImportRow,
  ImportRowStatus,
} from "./types.js";
import type { NewContact } from "./store.js";

// --- tiny CSV parser (handles quoted fields, escaped quotes, commas) ---------

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (field !== "" || row.length > 0) {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      }
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => (obj[h] = (r[idx] ?? "").trim()));
    return obj;
  });
}

// --- normalization + validation ---------------------------------------------

function pick(o: Record<string, string>, ...keys: string[]): string | null {
  for (const k of keys) if (o[k]) return o[k];
  return null;
}

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null; // unparseable
}

interface NormalizedRow {
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  city: string | null;
  zip: string | null;
}

function normalizeRow(o: Record<string, string>): NormalizedRow {
  const email = (pick(o, "email", "e-mail") ?? "").toLowerCase() || null;
  return {
    firstName: pick(o, "firstname", "first name", "first") ?? "",
    lastName: pick(o, "lastname", "last name", "last") ?? "",
    phone: normalizePhone(pick(o, "phone", "mobile", "cell")),
    email: email && /.+@.+\..+/.test(email) ? email : null,
    addressLine1: pick(o, "address", "addressline1", "address line 1", "street"),
    city: pick(o, "city"),
    zip: (pick(o, "zip", "zipcode", "zip code", "postal") ?? "").slice(0, 5) || null,
  };
}

function keyFor(row: NormalizedRow): string | null {
  if (row.email) return contactKeyFor(row.email);
  if (row.phone) return contactKeyFor(row.phone);
  return null;
}

// --- preview + commit --------------------------------------------------------

/**
 * Parse + classify a CSV without writing anything. Each row lands in exactly one
 * bucket: new, duplicate (key already exists), invalid (no name or no contact
 * method), or out_of_district (geocoded outside MO-02).
 */
export async function previewImport(csv: string): Promise<ImportPreview> {
  const store = await getStore();
  const parsed = parseCsv(csv).map(normalizeRow);
  const rows: ImportRow[] = [];
  const seenInBatch = new Set<string>();

  for (const r of parsed) {
    const key = keyFor(r);
    let status: ImportRowStatus = "new";
    let reason: string | null = null;

    if (!r.firstName || !r.lastName) {
      status = "invalid";
      reason = "missing name";
    } else if (!key) {
      status = "invalid";
      reason = "no email or phone";
    } else if (seenInBatch.has(key) || (await store.findContactByKey(key))) {
      status = "duplicate";
      reason = "already in list";
    } else {
      // Only geocode rows that have a street address; zip-only stays unknown.
      if (r.addressLine1) {
        const oneLine = `${r.addressLine1}, ${r.city ?? ""} MO ${r.zip ?? ""}`;
        const geo = await geocodeAddress(oneLine);
        if (geo.congressionalDistrict && geo.congressionalDistrict !== "MO-02") {
          status = "out_of_district";
          reason = `geocoded to ${geo.congressionalDistrict}`;
        }
      }
      if (key) seenInBatch.add(key);
    }

    rows.push({ ...r, status, reason, contactKey: key });
  }

  const counts: Record<ImportRowStatus, number> = {
    new: 0,
    duplicate: 0,
    invalid: 0,
    out_of_district: 0,
  };
  for (const row of rows) counts[row.status]++;

  return { total: rows.length, counts, rows };
}

/**
 * Commit a CSV: re-runs preview server-side (never trusts client classification)
 * and creates only the rows that are still "new". Re-geocodes to set the
 * in-district flag and census block on each created contact.
 */
export async function commitImport(
  csv: string,
  clerkId: string
): Promise<ImportResult> {
  const store = await getStore();
  const preview = await previewImport(csv);
  const toCreate: NewContact[] = [];

  for (const row of preview.rows) {
    if (row.status !== "new" || !row.contactKey) continue;
    let inDistrict: boolean | null = null;
    let censusBlock: string | null = null;
    if (row.addressLine1) {
      const oneLine = `${row.addressLine1}, ${row.city ?? ""} MO ${row.zip ?? ""}`;
      const geo = await geocodeAddress(oneLine);
      censusBlock = geo.censusBlock;
      inDistrict =
        geo.congressionalDistrict != null
          ? geo.congressionalDistrict === "MO-02"
          : null;
    }
    toCreate.push({
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      email: row.email,
      addressLine1: row.addressLine1,
      city: row.city,
      zip: row.zip,
      inDistrict,
      censusBlock,
      regStatus: "unknown",
      voteStatus: "unknown",
      voteMethod: null,
      votedAt: null,
      consentSms: false,
      consentEmail: false,
      consentSource: null,
      consentAt: null,
      optOut: false,
      tags: [],
      assignedClerkId: null,
      contactKey: row.contactKey,
      source: "import",
    });
  }

  const created = await store.bulkCreateContacts(toCreate);
  await audit(store, clerkId, "contacts.import", "task", `import:${created.length}`);
  return {
    created: created.length,
    skipped: preview.total - created.length,
    contactIds: created.map((c) => c.id),
  };
}

// --- dispositions + opt-out --------------------------------------------------

/** Result of a versioned contact mutation. `version_conflict` mirrors the
 *  task/shift optimistic-lock contract so routes can map it to 409. */
export type ContactWriteResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "version_conflict" };

export async function logDisposition(
  contactId: string,
  clerkId: string,
  channel: ContactLog["channel"],
  disposition: ContactDisposition,
  note: string | null
): Promise<ContactLog | null> {
  const store = await getStore();
  const contact = await store.getContact(contactId);
  if (!contact) return null;

  const log = await store.appendContactLog({
    contactId,
    clerkId,
    channel,
    disposition,
    note,
  });

  // Reflect terminal dispositions onto the contact (bumping its version).
  const now = new Date().toISOString();
  if (disposition === "registered") {
    await store.putContact({
      ...contact,
      regStatus: "registered",
      version: contact.version + 1,
      updatedAt: now,
    });
  } else if (disposition === "opted_out") {
    await store.putContact({
      ...contact,
      optOut: true,
      version: contact.version + 1,
      updatedAt: now,
    });
    await store.addOptOut(contact.contactKey);
  } else if (disposition === "pledged_to_vote") {
    // A commitment to vote — only advance from an earlier state (never
    // downgrade someone already recorded as voted).
    if (contact.voteStatus === "unknown") {
      await store.putContact({
        ...contact,
        voteStatus: "plan_made",
        version: contact.version + 1,
        updatedAt: now,
      });
    }
  } else if (
    disposition === "voted_early" ||
    disposition === "voted_absentee" ||
    disposition === "voted_election_day"
  ) {
    const voteMethod: NonNullable<Contact["voteMethod"]> =
      disposition === "voted_election_day"
        ? "election_day"
        : disposition === "voted_absentee"
          ? "absentee"
          : "early_in_person";
    // Election-day is the terminal "voted"; early/absentee are "early_voted".
    const voteStatus: Contact["voteStatus"] =
      disposition === "voted_election_day" ? "voted" : "early_voted";
    await store.putContact({
      ...contact,
      voteStatus,
      voteMethod,
      votedAt: contact.votedAt ?? now,
      version: contact.version + 1,
      updatedAt: now,
    });
  }
  return log;
}

export async function optOutContact(
  contactId: string,
  clerkId: string,
  expectedVersion?: number
): Promise<ContactWriteResult> {
  const store = await getStore();
  const contact = await store.getContact(contactId);
  if (!contact) return { ok: false, code: "not_found" };
  if (expectedVersion != null && expectedVersion !== contact.version)
    return { ok: false, code: "version_conflict" };
  await store.putContact({
    ...contact,
    optOut: true,
    version: contact.version + 1,
    updatedAt: new Date().toISOString(),
  });
  await store.addOptOut(contact.contactKey);
  await audit(store, clerkId, "contact.optout", "optout", contactId);
  return { ok: true };
}

/**
 * Record consent for a channel (TCPA prior-express-consent for SMS). Stores who
 * captured it and when. Revocation (consented=false) clears the channel flag.
 */
export async function recordConsent(
  contactId: string,
  channel: "sms" | "email",
  consented: boolean,
  clerkId: string,
  sourceNote: string | null,
  expectedVersion?: number
): Promise<ContactWriteResult> {
  const store = await getStore();
  const contact = await store.getContact(contactId);
  if (!contact) return { ok: false, code: "not_found" };
  if (expectedVersion != null && expectedVersion !== contact.version)
    return { ok: false, code: "version_conflict" };
  const now = new Date().toISOString();
  const updated = {
    ...contact,
    consentSms: channel === "sms" ? consented : contact.consentSms,
    consentEmail: channel === "email" ? consented : contact.consentEmail,
    consentSource: consented ? `${clerkId}${sourceNote ? `:${sourceNote}` : ""}` : contact.consentSource,
    consentAt: consented ? now : contact.consentAt,
    version: contact.version + 1,
    updatedAt: now,
  };
  await store.putContact(updated);
  await audit(store, clerkId, consented ? "contact.consent" : "contact.consent_revoke", "optout", contactId);
  return { ok: true };
}
