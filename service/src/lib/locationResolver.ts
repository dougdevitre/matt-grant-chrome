// The heart of the dynamic feature. Given (role scopes, phase, location), build
// an ordered, filtered list of ResourceCards across the four intent lanes.
//
// Pure-ish: external lookups are isolated in publicData.ts. This keeps card
// logic deterministic and unit-testable.

import type {
  Phase,
  ResolveResponse,
  ResolveEnrichment,
  ResolvedLocation,
  ResourceCard,
  Scope,
  LocationInput,
} from "./types.js";
import { currentPhase } from "../phase.js";
import {
  demographicsForZip,
  geocodeAddress,
  inferConfidence,
  leaForCounty,
  nearbyVenues,
} from "./publicData.js";
import { isConsistentSelection, leaIdFor } from "./locationOptions.js";
import { primaryNames } from "../data/mo02Candidates.js";
import { NODE_ENV } from "../config.js";

const SOS_REGISTER = "https://www.sos.mo.gov/elections/goVoteMissouri/register";
const SOS_STATUS = "https://voteroutreach.sos.mo.gov/portal/";
const SOS_POLLING = "https://www.sos.mo.gov/elections/goVoteMissouri/findyourpollingplace";
const SOS_BALLOT = "https://www.sos.mo.gov/elections/candidates";

function card(c: ResourceCard): ResourceCard {
  return c;
}

interface LeaInfo {
  url: string;
  name: string | null;
  phone: string | null;
  address: string | null;
}

// Full catalog. Filtering by role/phase/confidence happens after.
function catalog(loc: ResolvedLocation, lea: LeaInfo): ResourceCard[] {
  const allPhases: Phase[] = [
    "PHASE_1_REGISTER",
    "PHASE_2_PLAN",
    "PHASE_3_TURNOUT",
  ];
  return [
    // ---- VOTE ----
    card({
      id: "vote.register",
      lane: "vote",
      title: "Register to vote",
      body: "Missouri has no same-day registration. The deadline for the Aug 4 primary is July 8, 2026.",
      ctaLabel: "Register at sos.mo.gov",
      ctaUrl: SOS_REGISTER,
      source: "SOS",
      requiresScope: null,
      phases: ["PHASE_1_REGISTER"],
      confidenceMin: "LOW",
    }),
    card({
      id: "vote.status",
      lane: "vote",
      title: "Check your registration",
      body: "Confirm you are registered at your current address.",
      ctaLabel: "Check status",
      ctaUrl: SOS_STATUS,
      source: "SOS",
      requiresScope: null,
      phases: allPhases,
      confidenceMin: "LOW",
    }),
    card({
      id: "vote.early",
      lane: "vote",
      title: "Vote early",
      body: "No-excuse in-person early voting runs Jul 21 through Aug 3. Bring a valid photo ID.",
      ctaLabel: "Find your early-vote site",
      ctaUrl: lea.url,
      source: "SOS",
      requiresScope: null,
      phases: ["PHASE_2_PLAN", "PHASE_3_TURNOUT"],
      confidenceMin: "MEDIUM",
    }),
    // Your county's Local Election Authority — real office contact when we know
    // the county (MO-02 counties); omitted otherwise so we never show a blank.
    ...(lea.name && (lea.phone || lea.address)
      ? [
          card({
            id: "vote.authority",
            lane: "vote",
            title: lea.name,
            body: [lea.address, lea.phone].filter(Boolean).join(" · "),
            ctaLabel: "Visit your election office",
            ctaUrl: lea.url,
            source: "SOS",
            requiresScope: null,
            phases: allPhases,
            confidenceMin: "LOW",
          }),
        ]
      : []),
    card({
      id: "vote.polling",
      lane: "vote",
      title: "Find your polling place",
      body:
        loc.confidence === "HIGH"
          ? "Your exact polling place is based on your address."
          : "Enter your address to get your exact polling place.",
      ctaLabel: "Find polling place",
      ctaUrl: SOS_POLLING,
      source: "SOS",
      requiresScope: null,
      phases: ["PHASE_2_PLAN", "PHASE_3_TURNOUT"],
      confidenceMin: "LOW",
    }),
    card({
      id: "vote.ballot",
      lane: "vote",
      title: "Request the Republican ballot",
      body: "Missouri's primary is open — any registered voter may request the Republican ballot on election day.",
      ctaLabel: "See candidates & sample ballot",
      ctaUrl: SOS_BALLOT,
      source: "SOS",
      requiresScope: null,
      phases: ["PHASE_3_TURNOUT"],
      confidenceMin: "LOW",
    }),

    // ---- ISSUES ----
    card({
      id: "issues.candidates",
      lane: "issues",
      title: "Who's on the MO-02 ballot",
      body: `Republican primary (Aug 4): ${primaryNames("R")}. See the full official list and where Matt stands.`,
      ctaLabel: "View candidates",
      ctaUrl: SOS_BALLOT,
      source: "SOS",
      requiresScope: null,
      phases: allPhases,
      confidenceMin: "LOW",
    }),
    card({
      id: "issues.school",
      lane: "issues",
      title: `${loc.schoolDistrict || "Your"} school district on the ballot`,
      body: "Local school-board races and any levy or bond measures may share the Aug 4 ballot.",
      ctaLabel: "See local measures",
      ctaUrl: SOS_BALLOT,
      source: "DESE",
      requiresScope: null,
      phases: allPhases,
      confidenceMin: "MEDIUM",
    }),
    card({
      id: "issues.demographics",
      lane: "issues",
      title: `${loc.zip} neighborhood snapshot`,
      body: "Neutral Census context for outreach planning.",
      ctaLabel: null,
      ctaUrl: null,
      source: "Census",
      requiresScope: "finance.read",
      phases: allPhases,
      confidenceMin: "MEDIUM",
    }),

    // ---- VOLUNTEER ----
    card({
      id: "volunteer.shifts",
      lane: "volunteer",
      title: "Open volunteer shifts near you",
      body: "Find a registration drive or canvass shift in your area.",
      ctaLabel: "See shifts",
      ctaUrl: null,
      source: "internal",
      requiresScope: null,
      phases: allPhases,
      confidenceMin: "LOW",
    }),

    // ---- ACT (role-specific; gated by scope below) ----
    card({
      id: "act.register_contacts",
      lane: "act",
      title: "Send registration links",
      body: `Contacts in ${loc.zip} who still need to register before Jul 8.`,
      ctaLabel: "Open registration queue",
      ctaUrl: null,
      source: "internal",
      requiresScope: "voter.write",
      phases: ["PHASE_1_REGISTER"],
      confidenceMin: "LOW",
    }),
    card({
      id: "act.contact_queue",
      lane: "act",
      title: "Your call/text/door queue",
      body: `Phase-correct script for ${loc.zip}.`,
      ctaLabel: "Open queue",
      ctaUrl: null,
      source: "internal",
      requiresScope: "contact.log",
      phases: allPhases,
      confidenceMin: "LOW",
    }),
    card({
      id: "act.import",
      lane: "act",
      title: "Import & clean a list",
      body: `Scoped to ${loc.county} County; flags out-of-MO-02 rows and dedupes.`,
      ctaLabel: "Start import",
      ctaUrl: null,
      source: "internal",
      requiresScope: "list.import",
      phases: allPhases,
      confidenceMin: "LOW",
    }),
    card({
      id: "act.approve",
      lane: "act",
      title: "Review templates for compliance",
      body: "Check disclaimer + opt-out language before sends go out.",
      ctaLabel: "Open approvals",
      ctaUrl: null,
      source: "internal",
      requiresScope: "comms.approve",
      phases: allPhases,
      confidenceMin: "LOW",
    }),
    card({
      id: "act.events",
      lane: "act",
      title: "Plan a registration drive",
      body: `Suggested public venues in ${loc.county} County.`,
      ctaLabel: "Plan drive",
      ctaUrl: null,
      source: "OSM",
      requiresScope: "events.write",
      phases: ["PHASE_1_REGISTER", "PHASE_2_PLAN"],
      confidenceMin: "MEDIUM",
    }),
    card({
      id: "act.social",
      lane: "act",
      title: "Draft a local GOTV post",
      body: `Issue hooks for ${loc.schoolDistrict || "your district"} and ${loc.zip}.`,
      ctaLabel: "Draft post",
      ctaUrl: null,
      source: "internal",
      requiresScope: "comms.draft",
      phases: allPhases,
      confidenceMin: "LOW",
    }),
  ];
}

const CONFIDENCE_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

function visible(
  c: ResourceCard,
  phase: Phase,
  scopes: Scope[],
  confidence: string
): boolean {
  if (!c.phases.includes(phase)) return false;
  if (c.requiresScope && !scopes.includes(c.requiresScope)) return false;
  if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK[c.confidenceMin]) return false;
  return true;
}

export async function resolveLocalContext(
  input: LocationInput,
  scopes: Scope[],
  now: Date = new Date()
): Promise<ResolveResponse> {
  const geo = await geocodeAddress(input.address);
  const lea = await leaForCounty(input.county);
  // Prefer the reference dataset's real leaId for a known county+district
  // selection; fall back to the derived slug for free-text / unknown input.
  const datasetLeaId = leaIdFor(input.county, input.schoolDistrict);
  const leaId = datasetLeaId ?? lea.leaId;

  let confidence = inferConfidence(
    input.county,
    input.schoolDistrict,
    input.zip,
    geo.congressionalDistrict
  );
  // Keep confidence honest: without a geocoded address, only a selection that
  // matches the MO-02 roster (dropdowns) earns MEDIUM — an unknown/typo'd
  // free-text county+district+zip drops to LOW rather than looking trustworthy.
  if (
    confidence === "MEDIUM" &&
    !isConsistentSelection(input.county, input.schoolDistrict, input.zip)
  ) {
    confidence = "LOW";
  }

  // inDistrict: trust geocode when present; otherwise unknown (null) at LOW/MEDIUM.
  const inDistrict =
    geo.congressionalDistrict != null
      ? geo.congressionalDistrict === "MO-02"
      : null;

  const location: ResolvedLocation = {
    ...input,
    geocode: { lat: geo.lat, lng: geo.lng, censusBlock: geo.censusBlock },
    inDistrict,
    leaId,
    confidence,
    resolvedAt: now.toISOString(),
  };

  const phase = currentPhase(now);
  const cards = catalog(location, {
    url: lea.url,
    name: lea.name,
    phone: lea.phone,
    address: lea.address,
  }).filter((c) => visible(c, phase, scopes, confidence));

  const response: ResolveResponse = { location, phase, cards };

  // Public-data enrichment: ACS demographics + nearby civic venues. On by
  // default in production; opt-in elsewhere (so dev/tests stay fast and
  // deterministic). Explicit ENRICH_RESOLVE always wins. Both degrade to
  // null/empty and never block the response.
  const enrich =
    process.env.ENRICH_RESOLVE === "true" ||
    (NODE_ENV === "production" && process.env.ENRICH_RESOLVE !== "false");
  if (enrich) {
    const [demographics, venues] = await Promise.all([
      demographicsForZip(input.zip),
      nearbyVenues(geo.lat, geo.lng),
    ]);
    const enrichment: ResolveEnrichment = {
      demographics: demographics
        ? {
            population: demographics.population,
            medianHouseholdIncome: demographics.medianHouseholdIncome,
          }
        : null,
      venues,
    };
    response.enrichment = enrichment;

    // Surface the real numbers in the (finance-gated) neighborhood card so the
    // enrichment is actually visible, not just attached to the payload.
    const dem = enrichment.demographics;
    const demoCard = response.cards.find((c) => c.id === "issues.demographics");
    if (demoCard && dem && (dem.population != null || dem.medianHouseholdIncome != null)) {
      const pop = dem.population != null ? `~${dem.population.toLocaleString()} residents` : null;
      const inc =
        dem.medianHouseholdIncome != null
          ? `median household income ~$${dem.medianHouseholdIncome.toLocaleString()}`
          : null;
      demoCard.body = `${[pop, inc].filter(Boolean).join(", ")}. Neutral Census context for outreach planning.`;
    }
  }

  return response;
}
