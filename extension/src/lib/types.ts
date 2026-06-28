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
  optOut: boolean;
  tags: string[];
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
