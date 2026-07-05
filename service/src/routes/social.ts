// Social amplification routes. Volunteers (any signed-in clerk) read approved
// posts + blasts and self-report shares; the Social & Comms Clerk drafts and
// generates posts; a Compliance Clerk approves them. Draft visibility and all
// writes are scope-gated; the read of approved posts is open to any clerk so
// everyone can amplify. Mirrors routes/comms.ts conventions.

import { Router } from "express";
import { requireScope } from "../auth.js";
import {
  approveSocialPost,
  createBlast,
  createSocialPost,
  markShared,
  setBlastStatus,
} from "../lib/social.js";
import { getGenerator } from "../lib/socialGen.js";
import { getStore } from "../lib/store.js";
import { pathParam, queryStr } from "../lib/http.js";
import type {
  BlastStatus,
  Phase,
  SharePlatform,
  SocialCategory,
  SocialVariant,
} from "../lib/types.js";

export const socialRouter = Router();

const CATEGORIES: SocialCategory[] = ["register", "plan", "turnout", "donate"];
const PHASES: Phase[] = [
  "PHASE_1_REGISTER",
  "PHASE_2_PLAN",
  "PHASE_3_TURNOUT",
  "PHASE_CLOSED",
];
const PLATFORMS: SharePlatform[] = ["x", "facebook", "linkedin", "threads", "copy"];
const BLAST_STATUSES: BlastStatus[] = ["scheduled", "active", "done"];

const isCategory = (v: unknown): v is SocialCategory =>
  typeof v === "string" && CATEGORIES.includes(v as SocialCategory);

// Parse + validate a variants array from an untrusted body. Caps size and text
// length so a bad client can't store a huge blob.
function parseVariants(raw: unknown): SocialVariant[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) return null;
  const out: SocialVariant[] = [];
  for (const item of raw) {
    const platform = (item as { platform?: unknown })?.platform;
    const text = (item as { text?: unknown })?.text;
    if (
      typeof platform !== "string" ||
      !PLATFORMS.includes(platform as SharePlatform) ||
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 2000
    ) {
      return null;
    }
    out.push({ platform: platform as SharePlatform, text });
  }
  return out;
}

function parseHashtags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((h): h is string => typeof h === "string")
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .slice(0, 12);
}

// GET /social/posts?phase=&blastId=&category=&status=
// Any signed-in clerk sees approved posts. Requesting drafts needs comms.draft
// or comms.approve.
socialRouter.get("/posts", async (req, res) => {
  const store = await getStore();
  const status = queryStr(req, "status");
  const wantsDrafts = status === "draft" || status === "all";
  if (wantsDrafts) {
    const scopes = req.clerk?.scopes ?? [];
    if (!scopes.includes("comms.draft") && !scopes.includes("comms.approve")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
  }
  const phase = queryStr(req, "phase");
  const category = queryStr(req, "category");
  const posts = await store.listSocialPosts({
    status: status === "all" ? null : status === "draft" ? "draft" : "approved",
    blastId: queryStr(req, "blastId"),
    category: isCategory(category) ? category : null,
    phase: phase && PHASES.includes(phase as Phase) ? (phase as Phase) : null,
  });
  res.json(posts);
});

// POST /social/generate  { category, blastId? } — returns an UNSAVED draft
// suggestion for the drafter to edit, then POST to /social/posts.
socialRouter.post("/generate", requireScope("comms.draft"), async (req, res) => {
  const b = req.body ?? {};
  if (!isCategory(b.category)) {
    res.status(400).json({ error: "invalid_category" });
    return;
  }
  const blastId = typeof b.blastId === "string" && b.blastId ? b.blastId : null;
  res.json(getGenerator().generate({ category: b.category, blastId }));
});

// POST /social/posts — save a draft (Social & Comms Clerk).
socialRouter.post("/posts", requireScope("comms.draft"), async (req, res) => {
  const b = req.body ?? {};
  const variants = parseVariants(b.variants);
  if (!isCategory(b.category) || !b.title || !variants) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }
  const phases = Array.isArray(b.phases)
    ? (b.phases.filter((p: unknown) => PHASES.includes(p as Phase)) as Phase[])
    : [];
  const post = await createSocialPost(
    {
      blastId: typeof b.blastId === "string" && b.blastId ? b.blastId : null,
      category: b.category,
      phases,
      title: String(b.title).slice(0, 200),
      variants,
      hashtags: parseHashtags(b.hashtags),
      linkUrl: typeof b.linkUrl === "string" && b.linkUrl ? b.linkUrl : null,
      disclaimer: typeof b.disclaimer === "string" && b.disclaimer ? b.disclaimer : null,
      createdBy: req.clerk!.clerkId,
    },
    req.clerk!.clerkId
  );
  res.status(201).json(post);
});

// POST /social/posts/:id/approve  { approve?: boolean }
socialRouter.post("/posts/:id/approve", requireScope("comms.approve"), async (req, res) => {
  const approve = req.body?.approve !== false; // default true
  const result = await approveSocialPost(pathParam(req, "id"), approve, req.clerk!.clerkId);
  if (result.ok) {
    res.json(result.post);
    return;
  }
  res.status(result.code === "not_found" ? 404 : 409).json({ error: result.code });
});

// POST /social/posts/:id/shared  { platform? } — any signed-in clerk amplifies.
socialRouter.post("/posts/:id/shared", async (req, res) => {
  const platform = req.body?.platform;
  const result = await markShared(
    pathParam(req, "id"),
    req.clerk!.clerkId,
    typeof platform === "string" && PLATFORMS.includes(platform as SharePlatform)
      ? platform
      : undefined
  );
  if (result.ok) {
    res.json({ status: "shared", shareCount: result.post!.shareCount });
    return;
  }
  res.status(result.code === "not_found" ? 404 : 409).json({ error: result.code });
});

// GET /social/blasts?status= — any signed-in clerk.
socialRouter.get("/blasts", async (req, res) => {
  const store = await getStore();
  const status = queryStr(req, "status");
  res.json(
    await store.listSocialBlasts({
      status: status && BLAST_STATUSES.includes(status as BlastStatus)
        ? (status as BlastStatus)
        : null,
    })
  );
});

// POST /social/blasts — schedule a blast (Social & Comms Clerk).
socialRouter.post("/blasts", requireScope("comms.draft"), async (req, res) => {
  const b = req.body ?? {};
  if (!b.title || !b.scheduledFor) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }
  const phases = Array.isArray(b.phases)
    ? (b.phases.filter((p: unknown) => PHASES.includes(p as Phase)) as Phase[])
    : [];
  const status: BlastStatus = BLAST_STATUSES.includes(b.status) ? b.status : "scheduled";
  const goal = typeof b.goal === "number" && b.goal > 0 ? Math.floor(b.goal) : 0;
  const blast = await createBlast(
    {
      title: String(b.title).slice(0, 200),
      theme: typeof b.theme === "string" ? b.theme.slice(0, 500) : "",
      phases,
      scheduledFor: String(b.scheduledFor),
      goal,
      status,
      createdBy: req.clerk!.clerkId,
    },
    req.clerk!.clerkId
  );
  res.status(201).json(blast);
});

// POST /social/blasts/:id/status  { status } — advance scheduled→active→done.
socialRouter.post("/blasts/:id/status", requireScope("comms.approve"), async (req, res) => {
  const status = req.body?.status;
  if (!BLAST_STATUSES.includes(status)) {
    res.status(400).json({ error: "invalid_status" });
    return;
  }
  const result = await setBlastStatus(pathParam(req, "id"), status, req.clerk!.clerkId);
  if (result.ok) {
    res.json(result.blast);
    return;
  }
  res.status(404).json({ error: result.code });
});
