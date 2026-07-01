// Display-only mirror of the service's types. The service is authoritative;
// these exist so the panel can render and gate UI.

export type Scope =
  | "voter.read"
  | "voter.write"
  | "contact.log"
  | "list.import"
  | "list.tag"
  | "comms.draft"
  | "comms.send"
  | "comms.approve"
  | "optout.manage"
  | "events.write"
  | "finance.read"
  | "audit.read"
  | "task.read"
  | "task.write";

export type Role =
  | "registration_clerk"
  | "voter_contact_clerk"
  | "list_data_clerk"
  | "compliance_clerk"
  | "events_clerk"
  | "social_comms_clerk"
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
}

// Options for the cascading County → School district → ZIP selectors.
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

export interface ResolvedLocation extends LocationInput {
  geocode: { lat: number | null; lng: number | null; censusBlock: string | null };
  inDistrict: boolean | null;
  leaId: string | null;
  confidence: Confidence;
  resolvedAt: string;
}

export interface ResolveResponse {
  location: ResolvedLocation;
  phase: Phase;
  cards: ResourceCard[];
}

// --- Tasks -----------------------------------------------------------------

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
  requiresScope: Scope;
  phases: Phase[];
  priority: number;
  dueAt: string | null;
  zip: string | null;
  status: TaskStatus;
  assignedClerkId: string | null;
  skipReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// --- Scheduling ------------------------------------------------------------

export type EventKind =
  | "registration_drive"
  | "canvass"
  | "phone_bank"
  | "early_vote_reminder";

export interface Shift {
  id: string;
  eventId: string;
  role: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  claimedBy: string[];
  version: number;
}

export interface EventWithShifts {
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
  shifts: Shift[];
}

// --- Comms (UI) ---

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
  complianceApprovalId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// --- Contacts (UI) ---

export type RegStatus = "unknown" | "unregistered" | "reg_link_sent" | "registered";
export type VoteStatus = "unknown" | "plan_made" | "early_voted" | "voted";
export type VoteMethod = "early_in_person" | "absentee" | "election_day";

export interface VotePlan {
  method: VoteMethod | null;
  date: string | null;
  time: string | null;
  needsRide: boolean;
  note: string | null;
  updatedAt: string;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  zip: string | null;
  inDistrict: boolean | null;
  regStatus: RegStatus;
  voteStatus: VoteStatus;
  voteMethod: VoteMethod | null;
  votePlan: VotePlan | null;
  optOut: boolean;
  tags: string[];
  version: number;
}

export interface PollingPlace {
  address: string | null;
  lea: { name: string | null; url: string; kind: string };
  lookupUrl: string;
}

export interface FollowUp {
  id: string;
  contactId: string;
  templateId: string | null;
  dueAt: string;
  note: string | null;
  status: "pending" | "done" | "cancelled";
}

export interface BatchResult {
  attempted: number;
  sent: number;
  blocked: number;
  failed: number;
  truncated: boolean;
}

export interface GotvZipRow {
  zip: string;
  total: number;
  cast: number;
  remaining: number;
}

export interface GotvDashboard {
  total: number;
  counts: Record<VoteStatus, number>;
  pledged: number;
  earlyVoted: number;
  voted: number;
  cast: number;
  remaining: number;
  byZip: GotvZipRow[];
}

export type ImportRowStatus = "new" | "duplicate" | "invalid" | "out_of_district";

export interface ImportRow {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  zip: string | null;
  status: ImportRowStatus;
  reason: string | null;
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
}
