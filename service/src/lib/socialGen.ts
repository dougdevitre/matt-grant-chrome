// Social post generator. Deterministically composes ready-to-share copy +
// hashtags from campaign facts already in the app (candidate, phase, links,
// committee name). No LLM, no network, no randomness — same input → same output,
// so it is trivially testable and safe.
//
// It is exposed behind a tiny GeneratorPort so a future LLM-backed driver can
// drop in without touching callers (mirrors STORE_DRIVER / MAILER_DRIVER). The
// only driver today is `template`.

import { COMMITTEE_NAME, DONATE_URL } from "../config.js";
import { MO02_PRIMARY } from "../data/mo02Candidates.js";
import type { Phase, SharePlatform, SocialCategory, SocialVariant } from "./types.js";

// Candidate this tool is for (the non-incumbent Republican in the field).
const CANDIDATE =
  MO02_PRIMARY.candidates.find((c) => c.party === "R" && !c.incumbent)?.name ??
  "Matt Grant";

const OFFICE = "MO-02"; // Missouri's 2nd congressional district

const LINKS = {
  register: "https://www.sos.mo.gov/elections/goVoteMissouri/register",
  plan: "https://voteroutreach.sos.mo.gov/portal/",
  turnout: "https://www.sos.mo.gov/elections/goVoteMissouri/findyourpollingplace",
  donate: DONATE_URL,
} as const satisfies Record<SocialCategory, string>;

// Phase relevance per category. Donate is evergreen across the active phases.
const ACTIVE_PHASES: Phase[] = ["PHASE_1_REGISTER", "PHASE_2_PLAN", "PHASE_3_TURNOUT"];
const PHASES_FOR: Record<SocialCategory, Phase[]> = {
  register: ["PHASE_1_REGISTER"],
  plan: ["PHASE_2_PLAN", "PHASE_3_TURNOUT"],
  turnout: ["PHASE_3_TURNOUT"],
  donate: ACTIVE_PHASES,
};

const BASE_HASHTAGS = ["#MO02", `#${CANDIDATE.replace(/\s+/g, "")}`];
const HASHTAGS_FOR: Record<SocialCategory, string[]> = {
  register: [...BASE_HASHTAGS, "#RegisterToVote", "#MissouriPrimary"],
  plan: [...BASE_HASHTAGS, "#MakeAPlan", "#Vote"],
  turnout: [...BASE_HASHTAGS, "#VoteAug4", "#GOTV"],
  donate: [...BASE_HASHTAGS, "#Grassroots", "#ChipIn"],
};

const TITLE_FOR: Record<SocialCategory, string> = {
  register: "Register to vote — Jul 8 deadline",
  plan: "Make your plan to vote",
  turnout: "Turn out for Aug 4",
  donate: "Chip in for the campaign",
};

// Short (X) + long (Facebook/LinkedIn) copy per category. Kept concise so the X
// variant + a link + hashtags stays comfortably under 280 characters.
const COPY: Record<SocialCategory, { short: string; long: string }> = {
  register: {
    short: `Missouri's registration deadline for the Aug 4 primary is Jul 8 — no same-day registration. Register today and back ${CANDIDATE} for Congress in ${OFFICE}.`,
    long: `Don't miss it: the deadline to register for Missouri's Aug 4 primary is July 8, and there's no same-day registration. Take two minutes to register so you can vote for ${CANDIDATE} for Congress in ${OFFICE} — then share this with a friend who hasn't registered yet.`,
  },
  plan: {
    short: `Have a plan to vote in the Aug 4 primary, ${OFFICE}? Confirm your registration and pick your day, time, and polling place — then vote for ${CANDIDATE}.`,
    long: `Voters with a plan turn out. Confirm your registration and decide your day, time, and polling place for Missouri's Aug 4 primary. ${CANDIDATE} is running for Congress in ${OFFICE} and needs you to show up — make your plan today.`,
  },
  turnout: {
    short: `Polls are open for the Aug 4 primary in ${OFFICE}. Bring a photo ID and vote for ${CANDIDATE} for Congress. Find your polling place below.`,
    long: `It's time to vote in Missouri's Aug 4 primary. Bring a photo ID, look up your polling place, and cast your ballot for ${CANDIDATE} for Congress in ${OFFICE}. Every vote counts — bring a neighbor with you.`,
  },
  donate: {
    short: `Grassroots donors — not DC insiders — power this campaign. Chip in to help send ${CANDIDATE} to Congress for ${OFFICE}.`,
    long: `This campaign runs on grassroots support from neighbors like you, not DC special interests. Can you chip in today to help ${CANDIDATE} win ${OFFICE}? Every dollar goes straight to reaching voters before Aug 4.`,
  },
};

export interface GenerateInput {
  category: SocialCategory;
  /** Optional blast to attach the draft to. */
  blastId?: string | null;
}

export interface GeneratedPost {
  category: SocialCategory;
  phases: Phase[];
  title: string;
  variants: SocialVariant[];
  hashtags: string[];
  linkUrl: string;
  disclaimer: string;
  blastId: string | null;
}

export interface GeneratorPort {
  generate(input: GenerateInput): GeneratedPost;
}

const templateGenerator: GeneratorPort = {
  generate({ category, blastId = null }) {
    const copy = COPY[category];
    const variants: SocialVariant[] = [
      { platform: "x" as SharePlatform, text: copy.short },
      { platform: "facebook" as SharePlatform, text: copy.long },
      { platform: "linkedin" as SharePlatform, text: copy.long },
    ];
    return {
      category,
      phases: PHASES_FOR[category],
      title: TITLE_FOR[category],
      variants,
      hashtags: HASHTAGS_FOR[category],
      linkUrl: LINKS[category],
      // FEC "Paid for by" attribution — validated + required before approval.
      disclaimer: `Paid for by ${COMMITTEE_NAME}.`,
      blastId,
    };
  },
};

/** The configured generator. Only `template` exists today. */
export function getGenerator(): GeneratorPort {
  // Reserved for a future `llm` driver; anything else falls back to template.
  return templateGenerator;
}

export const CATEGORIES: SocialCategory[] = ["register", "plan", "turnout", "donate"];
