// Canonical types for the matt-grant-chrome microservice.
// The extension mirrors a subset of these for display only.

export type Scope =
  | "voter.read"
  | "voter.write"
  | "contact.log"
  | "list.import"
  | "list.tag"
  | "comms.draft"
  | "comms.send"
  | "comms.send_registration"
  | "comms.approve"
  | "sms.send"
  | "optout.manage"
  | "events.write"
  | "finance.read"
  | "audit.read"
  | "task.read"
  | "task.write"
  | "team.read"
  | "team.manage";

export type Role =
  | "registration_clerk"
  | "voter_contact_clerk"
  | "list_data_clerk"
  | "compliance_clerk"
  | "events_clerk"
  | "social_comms_clerk"
  | "team_captain"
  | "admin"
  | "public";

export type Phase =
  | "PHASE_1_REGISTER"
  | "PHASE_2_PLAN"
  | "PHASE_3_TURNOUT"
  | "PHASE_CLOSED";

export type Lane = "vote" | "issues" | "volunteer" | "act";
export type Confidence = "LOW" | "MEDIUM" | "HIGH";

export interface ClerkIdentity {
  clerkId: string;
  role: Role;
  scopes: Scope[];
  // Set when an admin is previewing another role via `GET /me?as=<role>`.
  viewAs?: boolean;
}

// A volunteer on a captain's team. The app otherwise stores no clerk identity
// (clerks are opaque JWT subjects), so this roster is the source of volunteer
// display names and the captain→volunteer link.
export interface TeamMember {
  id: string;
  clerkId: string; // the volunteer's Clerk subject (matches JWT `sub`)
  displayName: string;
  email: string | null;
  phone: string | null;
  teamId: string | null;
  captainClerkId: string; // the captain who manages this volunteer
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// A volunteer plus the work assigned to / claimed by them — the payload behind
// a captain's per-volunteer view.
export interface VolunteerWork {
  volunteer: TeamMember;
  tasks: Task[];
  shifts: Shift[];
  recentActivity: AuditEvent[];
}

export interface PhaseConfig {
  phase: Phase;
  label: string;
  primaryCta: string;
  nextDeadline: string;
}

export interface LocationInput {
  county: string;
  schoolDistrict: string;
  zip: string;
  address?: string | null;
  /** Device coordinates from "use my current location". When present the server
   *  reverse-geocodes them for the district check (as authoritative as an
   *  address), so resolution can reach HIGH confidence without a typed address. */
  coords?: { lat: number; lng: number } | null;
}

/** Result of POST /location/reverse-geocode — what a lat/lng maps to. */
export interface ReverseGeocoded {
  county: string | null;
  zip: string | null;
  schoolDistrict: string | null;
  inDistrict: boolean | null;
  congressionalDistrict: string | null;
  censusBlock: string | null;
}

// Options for the extension's cascading County → School district → ZIP selectors.
export interface LocationOptionsDistrict {
  name: string;
  leaId: string;
}
export interface LocationOptionsCounty {
  county: string;
  schoolDistricts: LocationOptionsDistrict[];
  zips: string[];
}
export interface LocationOptions {
  counties: LocationOptionsCounty[];
}

export interface ResolvedLocation extends LocationInput {
  geocode: { lat: number | null; lng: number | null; censusBlock: string | null };
  inDistrict: boolean | null;
  leaId: string | null;
  confidence: Confidence;
  resolvedAt: string;
}

export interface ResourceCard {
  id: string;
  lane: Lane;
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  source: "SOS" | "DESE" | "Census" | "FEC" | "OSM" | "internal";
  requiresScope: Scope | null;
  phases: Phase[];
  confidenceMin: Confidence;
}

// Optional public-data enrichment, attached only when ENRICH_RESOLVE=true.
// Server-side; degrades to nulls/empty so it never blocks a resolve.
export interface ResolveEnrichment {
  demographics: {
    population: number | null;
    medianHouseholdIncome: number | null;
  } | null;
  venues: Array<{ name: string; lat: number; lng: number; kind: string }>;
}

export interface ResolveResponse {
  location: ResolvedLocation;
  phase: Phase;
  cards: ResourceCard[];
  enrichment?: ResolveEnrichment;
}

// ---------------------------------------------------------------------------
// Task fulfillment
// ---------------------------------------------------------------------------

export type TaskKind =
  | "register_contact"
  | "call"
  | "text"
  | "door"
  | "approve_template"
  | "import_list"
  | "social_post"
  | "event_followup";

export type TaskStatus = "open" | "claimed" | "in_progress" | "done" | "skipped";

export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  detail: string;
  requiresScope: Scope; // which scope a clerk needs to work it
  phases: Phase[]; // phases in which it can be completed
  priority: number; // higher = surface sooner
  dueAt: string | null;
  zip: string | null; // optional location scoping
  status: TaskStatus;
  assignedClerkId: string | null;
  skipReason: string | null;
  version: number; // optimistic concurrency
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Scheduling: events + volunteer shifts
// ---------------------------------------------------------------------------

export type EventKind =
  | "registration_drive"
  | "canvass"
  | "phone_bank"
  | "early_vote_reminder";

export interface CampaignEvent {
  id: string;
  title: string;
  kind: EventKind;
  county: string;
  zip: string | null;
  venueName: string | null;
  startsAt: string;
  endsAt: string;
  phases: Phase[];
  createdBy: string;
  createdAt: string;
}

export interface Shift {
  id: string;
  eventId: string;
  role: string; // e.g. "Table captain", "Greeter"
  startsAt: string;
  endsAt: string;
  capacity: number;
  claimedBy: string[]; // clerkIds
  version: number;
}

export interface EventWithShifts extends CampaignEvent {
  shifts: Shift[];
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEvent {
  id: string;
  ts: string;
  clerkId: string;
  action: string;
  entity: "task" | "event" | "shift" | "template" | "send" | "optout" | "contact" | "followup";
  entityId: string;
  // Tamper-evident hash chain (filled by the store on append).
  seq?: number;
  prevHash?: string | null;
  hash?: string;
}

// ---------------------------------------------------------------------------
// Phase 3 — Comms: templates, opt-out, outbox
// ---------------------------------------------------------------------------

export type TemplateCategory = "register" | "plan" | "turnout";
export type CommsChannel = "email" | "sms" | "social";

export interface MessageTemplate {
  id: string;
  category: TemplateCategory;
  channel: CommsChannel;
  subject: string | null;
  body: string;
  hasDisclaimer: boolean;
  hasOptOut: boolean;
  complianceApprovalId: string | null; // set by a Compliance Clerk on approval
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type OutboxStatus = "queued" | "sent" | "failed" | "blocked";

export interface OutboxEntry {
  id: string;
  templateId: string;
  channel: CommsChannel;
  // Opaque, non-PII key for a recipient (e.g. a hash). Raw address is never stored.
  contactKey: string;
  idempotencyKey: string;
  status: OutboxStatus;
  reason: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Phase 4 — Local Election Authority (MO SOS)
// ---------------------------------------------------------------------------

export type LeaKind = "board_of_election_commissioners" | "county_clerk";

export interface LeaRecord {
  county: string;
  leaId: string;
  name: string;
  kind: LeaKind;
  jurisdictionUrl: string | null; // populate from SOS directory
  phone: string | null;
  address: string | null;
  hoursNote: string | null;
  sosLookupUrl: string; // always-available official fallback
}

// ---------------------------------------------------------------------------
// Contacts (the data layer tasks + comms act on)
// ---------------------------------------------------------------------------

export type RegStatus = "unknown" | "unregistered" | "reg_link_sent" | "registered";
export type VoteStatus = "unknown" | "plan_made" | "early_voted" | "voted";
export type VoteMethod = "early_in_person" | "absentee" | "election_day";

/** A voter's plan for how/when/where they'll cast a ballot (GOTV). */
export interface VotePlan {
  method: VoteMethod | null;
  date: string | null; // ISO date they plan to vote (YYYY-MM-DD)
  time: string | null; // free text, e.g. "before work"
  needsRide: boolean; // flag for a ride to the polls
  note: string | null;
  updatedAt: string;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  city: string | null;
  zip: string | null;
  inDistrict: boolean | null;
  censusBlock: string | null;
  regStatus: RegStatus;
  voteStatus: VoteStatus;
  voteMethod: VoteMethod | null; // how they voted / plan to vote
  votedAt: string | null; // ISO timestamp when recorded voted
  votePlan: VotePlan | null; // GOTV: when/how/where they plan to vote
  consentSms: boolean;
  consentEmail: boolean;
  consentSource: string | null; // how/when consent was obtained
  consentAt: string | null;
  optOut: boolean;
  tags: string[];
  assignedClerkId: string | null;
  contactKey: string; // opaque key shared with the opt-out list
  source: string; // e.g. "import", "manual"
  version: number; // optimistic concurrency
  createdAt: string;
  updatedAt: string;
}

export type ContactDisposition =
  | "not_home"
  | "supportive"
  | "undecided"
  | "opposed"
  | "registered"
  | "opted_out"
  // GOTV / turnout dispositions
  | "pledged_to_vote"
  | "voted_early"
  | "voted_absentee"
  | "voted_election_day";

export interface ContactLog {
  id: string;
  contactId: string;
  clerkId: string;
  channel: "call" | "text" | "door" | "email";
  disposition: ContactDisposition;
  note: string | null;
  createdAt: string;
}

/**
 * A scheduled follow-up for a contact (GOTV). Surfaced to a clerk when due —
 * there is no auto-sender, so the clerk sends via the normal approved flow,
 * keeping a human in the loop for TCPA. `templateId` is an optional suggestion.
 */
export type FollowUpStatus = "pending" | "done" | "cancelled";

export interface FollowUp {
  id: string;
  contactId: string;
  clerkId: string; // who scheduled it
  templateId: string | null; // suggested template to send
  dueAt: string; // ISO — when it should surface
  note: string | null;
  status: FollowUpStatus;
  createdAt: string;
  updatedAt: string;
}

// Import staging
// "suppressed" = the contact previously opted out; never silently re-added.
export type ImportRowStatus =
  | "new"
  | "duplicate"
  | "invalid"
  | "out_of_district"
  | "suppressed";

export interface ImportRow {
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  city: string | null;
  zip: string | null;
  status: ImportRowStatus;
  reason: string | null;
  contactKey: string | null;
  // Geocode result computed once at preview time so commit never re-geocodes.
  inDistrict: boolean | null;
  censusBlock: string | null;
}

export interface ImportPreview {
  total: number;
  counts: Record<ImportRowStatus, number>;
  rows: ImportRow[];
}

export interface ImportResult {
  created: number;
  skipped: number;
  contactIds: string[];
  // Fixable rows that did not import (1-based CSV row number + why), so staff
  // can correct and re-import instead of losing them silently.
  errors: { row: number; reason: string }[];
}
