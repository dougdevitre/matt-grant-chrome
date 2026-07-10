import { Router } from "express";
import { requireScope, requirePhaseWritable } from "../auth.js";
import {
  addShift,
  claimShift,
  createEvent,
  listEvents,
  myShifts,
} from "../lib/scheduling.js";
import { pathParam, queryStr } from "../lib/http.js";
import { parsePageParams, applyPage } from "../lib/pagination.js";
import type { EventKind, Phase } from "../lib/types.js";

export const eventsRouter = Router();

const VALID_KINDS: EventKind[] = [
  "registration_drive",
  "canvass",
  "phone_bank",
  "early_vote_reminder",
];

const VALID_PHASES: Phase[] = [
  "PHASE_1_REGISTER",
  "PHASE_2_PLAN",
  "PHASE_3_TURNOUT",
  "PHASE_CLOSED",
];

// Default phase window per kind. Events are phase-filtered on read, so a bad
// default makes an event invisible — the old blanket PHASE_1_REGISTER default
// meant any event created after Jul 8 without explicit phases never showed up.
const PHASES_FOR_KIND: Record<EventKind, Phase[]> = {
  registration_drive: ["PHASE_1_REGISTER"],
  canvass: ["PHASE_2_PLAN", "PHASE_3_TURNOUT"],
  phone_bank: ["PHASE_2_PLAN", "PHASE_3_TURNOUT"],
  early_vote_reminder: ["PHASE_3_TURNOUT"],
};

// GET /events?county=&zip=&limit=&offset= — phase-filtered events with shifts.
eventsRouter.get("/", requireScope("voter.read"), async (req, res) => {
  const county = queryStr(req, "county");
  const zip = queryStr(req, "zip");
  const all = await listEvents({ county, zip });
  res.setHeader("X-Total-Count", String(all.length));
  res.json(applyPage(all, parsePageParams(req)));
});

// POST /events — Events Clerk creates a drive/canvass/phone bank.
eventsRouter.post("/", requireScope("events.write"), requirePhaseWritable, async (req, res) => {
  const b = req.body ?? {};
  if (!b.title || !VALID_KINDS.includes(b.kind) || !b.county || !b.startsAt || !b.endsAt) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }
  // listEvents sorts by Date.parse(startsAt) — an unparseable date breaks the
  // calendar ordering, so reject it up front (mirrors the followups route).
  if (Number.isNaN(Date.parse(String(b.startsAt))) || Number.isNaN(Date.parse(String(b.endsAt)))) {
    res.status(400).json({ error: "invalid_date" });
    return;
  }
  const givenPhases = Array.isArray(b.phases)
    ? (b.phases.filter((p: unknown) => VALID_PHASES.includes(p as Phase)) as Phase[])
    : [];
  const phases: Phase[] = givenPhases.length ? givenPhases : PHASES_FOR_KIND[b.kind as EventKind];
  const event = await createEvent(
    {
      title: String(b.title),
      kind: b.kind,
      county: String(b.county),
      zip: b.zip ?? null,
      venueName: b.venueName ?? null,
      startsAt: String(b.startsAt),
      endsAt: String(b.endsAt),
      phases,
      createdBy: req.clerk!.clerkId,
    },
    req.clerk!.clerkId
  );
  res.status(201).json(event);
});

// POST /events/:id/shifts — add a shift to an event.
eventsRouter.post("/:id/shifts", requireScope("events.write"), requirePhaseWritable, async (req, res) => {
  const b = req.body ?? {};
  if (!b.role || !b.startsAt || !b.endsAt || typeof b.capacity !== "number") {
    res.status(400).json({ error: "missing_fields" });
    return;
  }
  if (Number.isNaN(Date.parse(String(b.startsAt))) || Number.isNaN(Date.parse(String(b.endsAt)))) {
    res.status(400).json({ error: "invalid_date" });
    return;
  }
  // capacity <= 0 would make the shift permanently unclaimable (claimed >= cap
  // is immediately true), so require a positive integer.
  if (!Number.isInteger(b.capacity) || b.capacity < 1) {
    res.status(400).json({ error: "invalid_capacity" });
    return;
  }
  const shift = await addShift(
    {
      eventId: pathParam(req, "id"),
      role: String(b.role),
      startsAt: String(b.startsAt),
      endsAt: String(b.endsAt),
      capacity: b.capacity,
    },
    req.clerk!.clerkId
  );
  if (!shift) {
    res.status(404).json({ error: "event_not_found" });
    return;
  }
  res.status(201).json(shift);
});

// GET /events/shifts/mine — shifts this clerk has claimed.
eventsRouter.get("/shifts/mine", requireScope("task.read"), async (req, res) => {
  res.json(await myShifts(req.clerk!.clerkId));
});

// POST /events/shifts/:shiftId/claim — any clerk may volunteer (task.read is the
// baseline every clerk role carries; the voter-facing `public` role cannot).
eventsRouter.post("/shifts/:shiftId/claim", requireScope("task.read"), requirePhaseWritable, async (req, res) => {
  const expectedVersion =
    typeof req.body?.version === "number" ? req.body.version : undefined;
  const result = await claimShift(pathParam(req, "shiftId"), req.clerk!.clerkId, expectedVersion);
  if (result.ok) {
    res.json(result.shift);
    return;
  }
  const status = result.code === "not_found" ? 404 : 409;
  res.status(status).json({ error: result.code });
});
