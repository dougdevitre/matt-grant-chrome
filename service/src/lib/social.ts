// Social amplification domain logic. Mirrors the comms pipeline: a post is
// drafted, a Compliance Clerk approves it (disclaimer required), and only
// approved posts are surfaced to volunteers to share. Volunteers share to their
// OWN channels — the app never posts on their behalf — and self-report via
// markShared. Every mutation is audited.

import { randomUUID } from "node:crypto";
import { COMMITTEE_NAME } from "../config.js";
import { audit, getStore } from "./store.js";
import type { NewSocialBlast, NewSocialPost } from "./store.js";
import type { SocialBlast, SocialPost, BlastStatus } from "./types.js";

/** True if `text` carries a valid FEC disclaimer (phrase AND committee name). */
export function detectDisclaimer(text: string): boolean {
  return /paid for by/i.test(text) && text.toLowerCase().includes(COMMITTEE_NAME.toLowerCase());
}

/**
 * Derive whether a post is compliant: the disclaimer line OR any variant body
 * must carry the "Paid for by <committee>" attribution. (A generator sets the
 * disclaimer field; a hand-authored post may inline it in the copy instead.)
 */
function postHasDisclaimer(input: Pick<NewSocialPost, "disclaimer" | "variants">): boolean {
  if (input.disclaimer && detectDisclaimer(input.disclaimer)) return true;
  return input.variants.some((v) => detectDisclaimer(v.text));
}

export async function createSocialPost(
  input: Omit<NewSocialPost, "hasDisclaimer" | "status">,
  clerkId: string
): Promise<SocialPost> {
  const store = await getStore();
  const post = await store.createSocialPost({
    ...input,
    hasDisclaimer: postHasDisclaimer(input),
    status: "draft",
  });
  await audit(store, clerkId, "social_post.create", "social_post", post.id);
  return post;
}

export interface ApprovePostResult {
  ok: boolean;
  code?: "not_found" | "missing_disclaimer";
  post?: SocialPost;
}

export async function approveSocialPost(
  id: string,
  approve: boolean,
  clerkId: string
): Promise<ApprovePostResult> {
  const store = await getStore();
  const post = await store.getSocialPost(id);
  if (!post) return { ok: false, code: "not_found" };
  if (approve && !post.hasDisclaimer) return { ok: false, code: "missing_disclaimer" };
  const updated: SocialPost = {
    ...post,
    status: approve ? "approved" : "draft",
    complianceApprovalId: approve ? `appr_${randomUUID().slice(0, 8)}` : null,
    updatedAt: new Date().toISOString(),
  };
  await store.putSocialPost(updated);
  await audit(
    store,
    clerkId,
    approve ? "social_post.approve" : "social_post.reject",
    "social_post",
    id
  );
  return { ok: true, post: updated };
}

export interface MarkSharedResult {
  ok: boolean;
  code?: "not_found" | "not_approved";
  post?: SocialPost;
}

/**
 * A volunteer self-reports sharing an approved post to their own channel. Only
 * approved posts count (a draft isn't shareable), and the action is audited so
 * the amplification total is attributable.
 */
export async function markShared(
  id: string,
  clerkId: string,
  platform?: string
): Promise<MarkSharedResult> {
  const store = await getStore();
  const post = await store.getSocialPost(id);
  if (!post) return { ok: false, code: "not_found" };
  if (post.status !== "approved") return { ok: false, code: "not_approved" };
  const updated = await store.incrementShareCount(id);
  if (!updated) return { ok: false, code: "not_found" };
  await audit(
    store,
    clerkId,
    platform ? `social_post.shared.${platform}` : "social_post.shared",
    "social_post",
    id
  );
  return { ok: true, post: updated };
}

export async function createBlast(
  input: NewSocialBlast,
  clerkId: string
): Promise<SocialBlast> {
  const store = await getStore();
  const blast = await store.createSocialBlast(input);
  await audit(store, clerkId, "social_blast.create", "social_blast", blast.id);
  return blast;
}

export interface SetBlastStatusResult {
  ok: boolean;
  code?: "not_found";
  blast?: SocialBlast;
}

export async function setBlastStatus(
  id: string,
  status: BlastStatus,
  clerkId: string
): Promise<SetBlastStatusResult> {
  const store = await getStore();
  const blast = await store.getSocialBlast(id);
  if (!blast) return { ok: false, code: "not_found" };
  const updated: SocialBlast = { ...blast, status, updatedAt: new Date().toISOString() };
  await store.putSocialBlast(updated);
  await audit(store, clerkId, `social_blast.${status}`, "social_blast", id);
  return { ok: true, blast: updated };
}
