// GOTV (get-out-the-vote) progress aggregation. Reads the whole contact set and
// reduces it to turnout counts — overall and per ZIP — so the team can watch
// ballots cast climb toward a goal. O(n) over contacts; fine at campaign scale
// and behind the `voter.read` scope. Surfaces counts only, never voter PII.

import { getStore } from "./store.js";
import type { VoteStatus } from "./types.js";

export interface GotvZipRow {
  zip: string;
  total: number;
  cast: number; // early_voted + voted
  remaining: number; // total - cast
}

export interface GotvDashboard {
  total: number;
  counts: Record<VoteStatus, number>;
  pledged: number; // plan_made — committed but not yet cast
  earlyVoted: number; // early_voted (early in-person or absentee)
  voted: number; // voted (election day / confirmed)
  cast: number; // early_voted + voted — a ballot is in
  remaining: number; // total - cast — still to turn out
  byZip: GotvZipRow[];
}

const EMPTY_COUNTS = (): Record<VoteStatus, number> => ({
  unknown: 0,
  plan_made: 0,
  early_voted: 0,
  voted: 0,
});

export async function gotvDashboard(): Promise<GotvDashboard> {
  const store = await getStore();
  const contacts = await store.listContacts({});

  const counts = EMPTY_COUNTS();
  const byZip = new Map<string, { total: number; cast: number }>();

  for (const c of contacts) {
    counts[c.voteStatus] = (counts[c.voteStatus] ?? 0) + 1;
    const cast = c.voteStatus === "early_voted" || c.voteStatus === "voted";
    const zip = c.zip ?? "—";
    const row = byZip.get(zip) ?? { total: 0, cast: 0 };
    row.total += 1;
    if (cast) row.cast += 1;
    byZip.set(zip, row);
  }

  const cast = counts.early_voted + counts.voted;
  const total = contacts.length;

  return {
    total,
    counts,
    pledged: counts.plan_made,
    earlyVoted: counts.early_voted,
    voted: counts.voted,
    cast,
    remaining: total - cast,
    byZip: [...byZip.entries()]
      .map(([zip, r]) => ({ zip, total: r.total, cast: r.cast, remaining: r.total - r.cast }))
      .sort((a, b) => b.remaining - a.remaining),
  };
}
