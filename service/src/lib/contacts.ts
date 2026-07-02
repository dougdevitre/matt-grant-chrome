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
  // Accept tab-delimited paste (Google Sheets / Excel) as well as CSV: pick the
  // delimiter from the header line so a clerk can paste straight from a sheet.
  const firstBreak = text.search(/\r|\n/);
  const headerLine = firstBreak === -1 ? text : text.slice(0, firstBreak);
  const delim = headerLine.includes("\t") ? "\t" : ",";

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
    } else if (ch === delim) {
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

const oneLineAddress = (r: NormalizedRow): string =>
  `${r.addressLine1}, ${r.city ?? ""} MO ${r.zip ?? ""}`;

type Geo = Awaited<ReturnType<typeof geocodeAddress>>;

/** Run `fn` over items with at most `limit` in flight (bounds the outbound
 *  geocode work so a large import doesn't fire hundreds of requests at once). */
async function mapWithLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

/** Build the NewContact for an intake row. In-district, not-yet-voted contacts
 *  are the GOTV target set, so tag them at intake to populate the filter. */
function buildNewContact(
  r: NormalizedRow,
  contactKey: string,
  inDistrict: boolean | null,
  censusBlock: string | null,
  source: string
): NewContact {
  return {
    firstName: r.firstName,
    lastName: r.lastName,
    phone: r.phone,
    email: r.email,
    addressLine1: r.addressLine1,
    city: r.city,
    zip: r.zip,
    inDistrict,
    censusBlock,
    regStatus: "unknown",
    voteStatus: "unknown",
    voteMethod: null,
    votedAt: null,
    votePlan: null,
    consentSms: false,
    consentEmail: false,
    consentSource: null,
    consentAt: null,
    optOut: false,
    tags: inDistrict === true ? ["gotv_target"] : [],
    assignedClerkId: null,
    contactKey,
    source,
  };
}

/**
 * Parse + classify a CSV without writing anything. Each row lands in exactly one
 * bucket: new, duplicate (key already exists), suppressed (previously opted out
 * — never silently re-added), invalid (no name or no contact method), or
 * out_of_district (geocoded outside MO-02). Address geocoding runs once here
 * (bounded concurrency) and the result rides on the row so commit never
 * re-geocodes.
 */
export async function previewImport(csv: string): Promise<ImportPreview> {
  const store = await getStore();
  const parsed = parseCsv(csv).map(normalizeRow);

  // Geocode every address-bearing row up front, capped, so a large list doesn't
  // serialize N slow lookups (or fire them all at once).
  const geoByIdx = new Map<number, Geo>();
  const withAddress = parsed
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !!r.addressLine1);
  await mapWithLimit(withAddress, 5, async ({ r, i }) => {
    geoByIdx.set(i, await geocodeAddress(oneLineAddress(r)));
  });

  const rows: ImportRow[] = [];
  const seenInBatch = new Set<string>();

  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i];
    const key = keyFor(r);
    const geo = geoByIdx.get(i) ?? null;
    const inDistrict =
      geo?.congressionalDistrict != null ? geo.congressionalDistrict === "MO-02" : null;
    const censusBlock = geo?.censusBlock ?? null;

    let status: ImportRowStatus = "new";
    let reason: string | null = null;

    if (!r.firstName || !r.lastName) {
      status = "invalid";
      reason = "missing name";
    } else if (!key) {
      status = "invalid";
      reason = "no email or phone";
    } else if (await store.isOptedOut(key)) {
      status = "suppressed";
      reason = "opted out — will not re-add";
    } else if (seenInBatch.has(key) || (await store.findContactByKey(key))) {
      status = "duplicate";
      reason = "already in list";
    } else if (geo?.congressionalDistrict && geo.congressionalDistrict !== "MO-02") {
      status = "out_of_district";
      reason = `geocoded to ${geo.congressionalDistrict}`;
    } else {
      seenInBatch.add(key);
    }

    rows.push({ ...r, status, reason, contactKey: key, inDistrict, censusBlock });
  }

  const counts: Record<ImportRowStatus, number> = {
    new: 0,
    duplicate: 0,
    invalid: 0,
    out_of_district: 0,
    suppressed: 0,
  };
  for (const row of rows) counts[row.status]++;

  return { total: rows.length, counts, rows };
}

/**
 * Commit a CSV: re-runs preview server-side (never trusts client classification)
 * and creates the rows that are still "new" — reusing the geocode from preview
 * (no second round of lookups). Creates row-by-row so a mid-import store failure
 * preserves the contacts already written and reports the rows that didn't land.
 */
export async function commitImport(
  csv: string,
  clerkId: string
): Promise<ImportResult> {
  const store = await getStore();
  const preview = await previewImport(csv);
  const contactIds: string[] = [];
  const errors: { row: number; reason: string }[] = [];

  for (let i = 0; i < preview.rows.length; i++) {
    const row = preview.rows[i];
    const csvRow = i + 2; // 1-based, accounting for the header line
    if (row.status === "invalid") {
      errors.push({ row: csvRow, reason: row.reason ?? "invalid" });
      continue;
    }
    // duplicate / suppressed / out_of_district are intentional skips, not errors.
    if (row.status !== "new" || !row.contactKey) continue;
    try {
      const c = await store.createContact(
        buildNewContact(row, row.contactKey, row.inDistrict, row.censusBlock, "import")
      );
      contactIds.push(c.id);
    } catch {
      errors.push({ row: csvRow, reason: "could not save" });
    }
  }

  await audit(store, clerkId, "contacts.import", "task", `import:${contactIds.length}`);
  return {
    created: contactIds.length,
    skipped: preview.total - contactIds.length,
    contactIds,
    errors,
  };
}

/** Result of adding a single contact (a clerk on a call, no CSV). */
export type AddContactResult =
  | { ok: true; contact: Contact }
  | { ok: false; code: "invalid" | "duplicate" | "suppressed"; reason: string };

/**
 * Add one contact through the same normalize → dedupe → geocode path as import,
 * so a manually-added voter is validated, opt-out-suppressed, and enriched
 * identically to an imported one.
 */
export async function addOneContact(
  input: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    addressLine1?: string;
    city?: string;
    zip?: string;
  },
  clerkId: string
): Promise<AddContactResult> {
  const store = await getStore();
  const r = normalizeRow({
    firstname: input.firstName ?? "",
    lastname: input.lastName ?? "",
    phone: input.phone ?? "",
    email: input.email ?? "",
    address: input.addressLine1 ?? "",
    city: input.city ?? "",
    zip: input.zip ?? "",
  });

  if (!r.firstName || !r.lastName) return { ok: false, code: "invalid", reason: "missing name" };
  const key = keyFor(r);
  if (!key) return { ok: false, code: "invalid", reason: "no email or phone" };
  if (await store.isOptedOut(key))
    return { ok: false, code: "suppressed", reason: "contact opted out" };
  if (await store.findContactByKey(key))
    return { ok: false, code: "duplicate", reason: "already in list" };

  const geo = r.addressLine1 ? await geocodeAddress(oneLineAddress(r)) : null;
  const inDistrict =
    geo?.congressionalDistrict != null ? geo.congressionalDistrict === "MO-02" : null;
  const contact = await store.createContact(
    buildNewContact(r, key, inDistrict, geo?.censusBlock ?? null, "manual")
  );
  await audit(store, clerkId, "contact.create", "contact", contact.id);
  return { ok: true, contact };
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

/**
 * Capture/replace a contact's vote plan (when/how/where + ride flag). Setting a
 * plan advances an unknown voteStatus to "plan_made" (never downgrades someone
 * already recorded as having voted).
 */
export async function setVotePlan(
  contactId: string,
  clerkId: string,
  plan: {
    method?: Contact["voteMethod"];
    date?: string | null;
    time?: string | null;
    needsRide?: boolean;
    note?: string | null;
  },
  expectedVersion?: number
): Promise<ContactWriteResult> {
  const store = await getStore();
  const contact = await store.getContact(contactId);
  if (!contact) return { ok: false, code: "not_found" };
  if (expectedVersion != null && expectedVersion !== contact.version)
    return { ok: false, code: "version_conflict" };
  const now = new Date().toISOString();
  await store.putContact({
    ...contact,
    votePlan: {
      method: plan.method ?? null,
      date: plan.date ?? null,
      time: plan.time ?? null,
      needsRide: plan.needsRide ?? false,
      note: plan.note ?? null,
      updatedAt: now,
    },
    // A plan implies intent to vote — advance only from "unknown".
    voteStatus: contact.voteStatus === "unknown" ? "plan_made" : contact.voteStatus,
    version: contact.version + 1,
    updatedAt: now,
  });
  await audit(store, clerkId, "contact.vote_plan", "contact", contactId);
  return { ok: true };
}
