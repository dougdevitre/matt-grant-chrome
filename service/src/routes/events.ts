import { Router } from "express";
import { requireScope } from "../auth.js";
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

// GET /events?county=&zip=&limit=&offset= — phase-filtered events with shifts.
eventsRouter.get("/", requireScope("voter.read"), async (req, res) => {
  const county = queryStr(req, "county");
  const zip = queryStr(req, "zip");
  const all = await listEvents({ county, zip });
  res.setHeader("X-Total-Count", String(all.length));
  res.json(applyPage(all, parsePageParams(req)));
});

// POST /events — Events Clerk creates a drive/canvass/phone bank.
eventsRouter.post("/", requireScope("events.write"), async (req, res) => {
  const b = req.body ?? {};
  if (!b.title || !VALID_KINDS.includes(b.kind) || !b.county || !b.startsAt || !b.endsAt) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }
  const phases: Phase[] = Array.isArray(b.phases) ? b.phases : ["PHASE_1_REGISTER"];
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
eventsRouter.post("/:id/shifts", requireScope("events.write"), async (req, res) => {
  const b = req.body ?? {};
  if (!b.role || !b.startsAt || !b.endsAt || typeof b.capacity !== "number") {
    res.status(400).json({ error: "missing_fields" });
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
eventsRouter.post("/shifts/:shiftId/claim", requireScope("task.read"), async (req, res) => {
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
