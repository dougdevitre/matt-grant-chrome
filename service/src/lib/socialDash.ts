// Media / amplification dashboard aggregation. Reduces approved posts + blasts
// into share progress — overall, per-blast (vs. goal), and per-platform — so the
// team can watch the coordinated push climb. O(n) over posts; fine at campaign
// scale. Counts only, no PII (mirrors lib/gotv.ts).

import { getStore } from "./store.js";
import type {
  SharePlatform,
  SocialBlast,
  SocialBlastProgress,
  SocialDashboard,
  SocialPost,
} from "./types.js";

function progressFor(blast: SocialBlast, posts: SocialPost[]): SocialBlastProgress {
  const inBlast = posts.filter((p) => p.blastId === blast.id);
  return {
    blastId: blast.id,
    title: blast.title,
    theme: blast.theme,
    status: blast.status,
    scheduledFor: blast.scheduledFor,
    goal: blast.goal,
    shares: inBlast.reduce((n, p) => n + p.shareCount, 0),
    posts: inBlast.length,
  };
}

export async function socialDashboard(): Promise<SocialDashboard> {
  const store = await getStore();
  // Approved posts are the amplifiable set; drafts don't count toward totals.
  const posts = await store.listSocialPosts({ status: "approved" });
  const blasts = await store.listSocialBlasts();

  const totalShares = posts.reduce((n, p) => n + p.shareCount, 0);

  const byBlast = blasts
    .map((b) => progressFor(b, posts))
    .sort((a, b) => b.shares - a.shares);

  // The single blast to feature: the active one with the most shares, if any.
  const activeBlast = byBlast.find((b) => b.status === "active") ?? null;

  const platformCounts = new Map<SharePlatform, number>();
  for (const p of posts) {
    for (const v of p.variants) {
      platformCounts.set(v.platform, (platformCounts.get(v.platform) ?? 0) + 1);
    }
  }
  const byPlatform = [...platformCounts.entries()]
    .map(([platform, count]) => ({ platform, posts: count }))
    .sort((a, b) => b.posts - a.posts);

  const topPosts = [...posts]
    .sort((a, b) => b.shareCount - a.shareCount)
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      title: p.title,
      category: p.category,
      shares: p.shareCount,
    }));

  return {
    activeBlast,
    totalShares,
    totalPosts: posts.length,
    byBlast,
    byPlatform,
    topPosts,
  };
}
