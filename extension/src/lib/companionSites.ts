// Registry for the context-aware "Working here" card. When the active browser
// tab is on an allow-listed campaign site, the panel shows the matching helper.
//
// PRIVACY: matching is on HOSTNAME ONLY — never page content, never the full
// URL/path. The extension can only see the URL of hosts it has host_permissions
// for (see manifest.json), so non-allow-listed tabs are invisible to the panel.
//
// Keep this list in lockstep with `host_permissions` in extension/public/manifest.json.

import type { Scope } from "./types.js";

export interface CompanionAction {
  label: string;
  url: string;
}

export interface CompanionSite {
  id: string;
  /** Match when the active host equals one of these or is a subdomain of it. */
  hostSuffixes: string[];
  /** Require at least one of these scopes; null = any signed-in role. */
  anyScopes: Scope[] | null;
  title: string;
  body: string;
  actions: CompanionAction[];
}

const SOS_REGISTER = "https://www.sos.mo.gov/elections/goVoteMissouri/register";
const SOS_STATUS = "https://voteroutreach.sos.mo.gov/portal/";
const SOS_POLLING =
  "https://www.sos.mo.gov/elections/goVoteMissouri/findyourpollingplace";

export const COMPANION_SITES: CompanionSite[] = [
  {
    id: "sos",
    hostSuffixes: ["sos.mo.gov", "voteroutreach.sos.mo.gov"],
    anyScopes: ["voter.read"],
    title: "You're on the Missouri voter site",
    body: "Register by Jul 8 for the Aug 4 primary. After you help someone, log the outcome in your Tasks / Contacts tab.",
    actions: [
      { label: "Register", url: SOS_REGISTER },
      { label: "Check status", url: SOS_STATUS },
      { label: "Find polling place", url: SOS_POLLING },
    ],
  },
  {
    id: "airtable",
    hostSuffixes: ["airtable.com"],
    anyScopes: ["list.import", "list.tag"],
    title: "Working in Airtable",
    body: "Got a voter list here? Open the Import tab in this panel to bring those contacts into the tool.",
    actions: [],
  },
  {
    id: "google-sheets",
    hostSuffixes: ["docs.google.com", "sheets.google.com"],
    anyScopes: ["list.import"],
    title: "Working in Google Sheets",
    body: "Download the sheet as CSV, then use the Import tab in this panel to load your voter list.",
    actions: [],
  },
  {
    id: "county-office",
    hostSuffixes: [
      "stlouiscountymo.gov",
      "sccmo.org",
      "franklinmo.org",
      "warrencountymoclerk.com",
    ],
    anyScopes: ["voter.read"],
    title: "You're on a county election office site",
    body: "This is a MO-02 Local Election Authority. Key dates: register by Jul 8, primary Aug 4.",
    actions: [
      { label: "Check status", url: SOS_STATUS },
      { label: "Find polling place", url: SOS_POLLING },
    ],
  },
  {
    id: "gmail",
    hostSuffixes: ["mail.google.com"],
    anyScopes: ["contact.log"],
    title: "Working in Gmail",
    body: "Emailing a voter? Log the outreach in your Tasks / Contacts tab so it's tracked and compliant.",
    actions: [],
  },
  {
    id: "calendar",
    hostSuffixes: ["calendar.google.com"],
    anyScopes: ["events.write"],
    title: "Working in Google Calendar",
    body: "Add campaign events and volunteer shifts from the Schedule tab so they reach clerks.",
    actions: [],
  },
  {
    id: "winred",
    hostSuffixes: ["winred.com"],
    anyScopes: ["finance.read"],
    title: "Working in WinRed",
    body: "Fundraising only — never mix a donor ask into GOTV texts. Keep the FEC record in the budget base.",
    actions: [],
  },
  {
    id: "social",
    hostSuffixes: ["x.com", "twitter.com", "facebook.com", "instagram.com", "youtube.com"],
    anyScopes: ["comms.draft"],
    title: "Posting on social",
    body: "Pull an approved template from the Comms tab. Post only compliant, approved messages.",
    actions: [],
  },
  // Voter-file companion (VAN/PDI/L2/GOP Data Center/i360) is intentionally
  // deferred until the campaign confirms which platform they use — its host
  // must be added here AND to manifest host_permissions.
];

const hostMatches = (host: string, suffix: string): boolean =>
  host === suffix || host.endsWith(`.${suffix}`);

/**
 * The companion entry for the active host that the caller's role can use, or
 * null. Hostname-only; role-gated by `anyScopes`.
 */
export function matchCompanion(
  host: string | null,
  scopes: Scope[]
): CompanionSite | null {
  if (!host) return null;
  return (
    COMPANION_SITES.find(
      (s) =>
        s.hostSuffixes.some((suffix) => hostMatches(host, suffix)) &&
        (s.anyScopes === null || s.anyScopes.some((sc) => scopes.includes(sc)))
    ) ?? null
  );
}
