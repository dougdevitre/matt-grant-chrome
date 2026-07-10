import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { messageForError } from "../lib/errors.js";
import {
  buildShareUrl,
  composeShareText,
  variantFor,
} from "../lib/shareLinks.js";
import type {
  ClerkIdentity,
  GeneratedPost,
  Phase,
  SharePlatform,
  SocialCategory,
  SocialDashboard,
  SocialPost,
} from "../lib/types.js";

const PLATFORM_LABEL: Record<SharePlatform, string> = {
  x: "X",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  threads: "Threads",
  copy: "Copy",
};

const CATEGORIES: SocialCategory[] = ["register", "plan", "turnout", "donate"];

// Open a URL in a new browser tab. In the side panel window.open can be blocked,
// so prefer chrome.tabs.create when available.
function openUrl(url: string): void {
  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    void chrome.tabs.create({ url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// One shareable post: choose a platform, preview the copy, then Copy / Share /
// mark it shared. Volunteers post to their OWN channels — nothing auto-posts.
function ShareCard({
  post,
  onShared,
}: {
  post: SocialPost;
  onShared: (id: string) => void;
}) {
  const platforms = post.variants.map((v) => v.platform);
  const [platform, setPlatform] = useState<SharePlatform>(platforms[0] ?? "x");
  const [note, setNote] = useState<string | null>(null);

  const text = variantFor(post.variants, platform);
  const content = {
    text,
    url: post.linkUrl,
    hashtags: post.hashtags,
    disclaimer: post.disclaimer,
  };
  const fullText = composeShareText(content);

  async function onCopy() {
    const ok = await copyText(fullText);
    setNote(ok ? "Copied — paste it into your post." : "Copy failed — select and copy manually.");
  }

  function onShare() {
    const url = buildShareUrl(platform, content);
    if (url) {
      openUrl(url);
      setNote("Composer opened in a new tab. Post it, then mark it shared.");
    } else {
      void onCopy();
    }
  }

  async function onMarkShared() {
    try {
      await api.markShared(post.id, platform);
      onShared(post.id);
      setNote("Thanks for amplifying! 🎉");
    } catch (e) {
      setNote(messageForError(e instanceof Error ? e.message : "share_failed"));
    }
  }

  return (
    <div className="card share-card">
      <span className="src">{post.category}</span>
      <h3>{post.title}</h3>

      <div className="share-platforms" role="tablist" aria-label="Choose a platform">
        {platforms.map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={platform === p}
            className={platform === p ? "chip active" : "chip"}
            onClick={() => setPlatform(p)}
          >
            {PLATFORM_LABEL[p]}
          </button>
        ))}
      </div>

      <p className="share-body">{text}</p>
      {post.hashtags.length ? (
        <p className="share-tags">{post.hashtags.join(" ")}</p>
      ) : null}
      {post.linkUrl ? <p className="share-link">{post.linkUrl}</p> : null}
      {post.disclaimer ? <p className="note share-disclaimer">{post.disclaimer}</p> : null}

      <div className="task-actions">
        <button className="btn" onClick={onShare}>
          {buildShareUrl(platform, content) ? `Share on ${PLATFORM_LABEL[platform]}` : "Copy"}
        </button>
        <button className="btn secondary" onClick={onCopy}>
          Copy text
        </button>
        <button className="btn secondary" onClick={onMarkShared}>
          Mark shared
        </button>
      </div>
      <div className="share-foot">
        <span className="tag">{post.shareCount} shares</span>
      </div>
      {note ? <div className="ok-note">{note}</div> : null}
    </div>
  );
}

// Drafting + generation for the Social & Comms Clerk (comms.draft).
function Authoring({ onSaved }: { onSaved: () => void }) {
  const [category, setCategory] = useState<SocialCategory>("register");
  const [draft, setDraft] = useState<GeneratedPost | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const g = await api.generatePost(category);
      setDraft(g);
      setTitle(g.title);
      setBody(variantFor(g.variants, "x"));
    } catch (e) {
      setError(messageForError(e instanceof Error ? e.message : "generate_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setError(null);
    setBusy(true);
    try {
      // Keep the generated multi-platform variants but let the drafter override
      // the primary (X) copy inline; save with the disclaimer + hashtags intact.
      const variants = draft.variants.map((v) =>
        v.platform === "x" ? { ...v, text: body } : v
      );
      await api.createSocialPost({
        category: draft.category,
        title: title || draft.title,
        variants,
        hashtags: draft.hashtags,
        linkUrl: draft.linkUrl,
        disclaimer: draft.disclaimer,
        phases: draft.phases,
        blastId: draft.blastId,
      });
      setDraft(null);
      setTitle("");
      setBody("");
      setMsg("Saved as a draft — a Compliance Clerk can approve it.");
      onSaved();
    } catch (e) {
      setError(messageForError(e instanceof Error ? e.message : "save_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="section-h">Create a post</h2>
      {error ? <div className="warn" role="alert">{error}</div> : null}
      <div className="form">
        <label>
          Theme
          <select
            className="select"
            value={category}
            onChange={(e) => setCategory(e.target.value as SocialCategory)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={busy} onClick={generate}>
          Generate text + hashtags
        </button>
        {draft ? (
          <>
            <label>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              Post text (X)
              <textarea
                className="textarea"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <p className="note">{draft.hashtags.join(" ")}</p>
            <p className="note share-disclaimer">{draft.disclaimer}</p>
            <button className="btn" disabled={busy || !body.trim()} onClick={save}>
              Save draft
            </button>
          </>
        ) : null}
        {msg ? <div className="ok-note">{msg}</div> : null}
      </div>
    </section>
  );
}

// Pending drafts. Compliance (comms.approve) can act on them; a drafter
// (comms.draft only) sees the same list read-only — otherwise a saved draft
// vanishes with no way to know whether it was approved or rejected.
function Approvals({
  posts,
  canApprove,
  onChanged,
}: {
  posts: SocialPost[];
  canApprove: boolean;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, approve: boolean) {
    setBusyId(id);
    setError(null);
    try {
      await api.approveSocialPost(id, approve);
      onChanged();
    } catch (e) {
      setError(messageForError(e instanceof Error ? e.message : "action_failed"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <h2 className="section-h">Pending review ({posts.length})</h2>
      {error ? <div className="warn" role="alert">{error}</div> : null}
      {posts.length === 0 ? (
        <p className="note">Nothing waiting.</p>
      ) : (
        posts.map((p) => (
          <div className="card" key={p.id}>
            <span className="src">{p.category}</span>
            <h3>{p.title}</h3>
            <p className="share-body">{variantFor(p.variants, "x")}</p>
            <div className="checks">
              <span className={p.hasDisclaimer ? "chk ok" : "chk bad"}>disclaimer</span>
            </div>
            {canApprove ? (
              <div className="task-actions">
                <button
                  className="btn"
                  disabled={busyId === p.id || !p.hasDisclaimer}
                  onClick={() => act(p.id, true)}
                >
                  Approve
                </button>
                <button
                  className="btn secondary"
                  disabled={busyId === p.id}
                  onClick={() => act(p.id, false)}
                >
                  Reject
                </button>
              </div>
            ) : (
              <p className="note">Waiting on a Compliance Clerk.</p>
            )}
          </div>
        ))
      )}
    </section>
  );
}

// The Share tab: an amplification dashboard + a library of approved posts every
// clerk can share to their own channels, plus authoring/approval for the roles
// that have those scopes.
export function SharePanel({ me, phase }: { me: ClerkIdentity; phase: Phase | null }) {
  const has = (s: string) => me.scopes.includes(s as never);
  const [dash, setDash] = useState<SocialDashboard | null>(null);
  const [posts, setPosts] = useState<SocialPost[] | null>(null);
  const [pending, setPending] = useState<SocialPost[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Only posts relevant to the current phase: a "Register by Jul 8" post
      // must not resurface after the deadline just because nothing newer is
      // approved yet. Unfiltered only when the phase is unknown.
      setPosts(await api.socialPosts(phase ? { phase } : {}));
      setDash(await api.socialDashboard());
      // Drafters and approvers both track the pending queue (the server allows
      // status=draft for either scope).
      if (has("comms.approve") || has("comms.draft")) {
        setPending(await api.socialPosts({ status: "draft" }));
      }
    } catch (e) {
      setError(messageForError(e instanceof Error ? e.message : "load_failed"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    load();
  }, [load]);

  function bumpShare(id: string) {
    setPosts((list) =>
      (list ?? []).map((p) =>
        p.id === id ? { ...p, shareCount: p.shareCount + 1 } : p
      )
    );
    setDash((d) => (d ? { ...d, totalShares: d.totalShares + 1 } : d));
  }

  const active = dash?.activeBlast ?? null;
  const pct = active && active.goal ? Math.min(100, Math.round((active.shares / active.goal) * 100)) : 0;

  return (
    <div className="panel">
      {error ? <div className="warn" role="alert">{error}</div> : null}

      {/* Amplification dashboard */}
      {active ? (
        <section>
          <h2 className="section-h">This week's blast</h2>
          <div className="card">
            <span className="src">{active.status}</span>
            <h3>{active.title}</h3>
            <p className="note">{active.theme}</p>
            <div
              className="gotv-bar"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Share of blast goal reached"
            >
              <div className="gotv-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="note">
              {active.shares} of {active.goal} shares ({pct}%)
            </p>
          </div>
        </section>
      ) : null}

      {dash ? (
        <div className="counts">
          <span className="pill done">{dash.totalShares} shares</span>
          <span className="pill">{dash.totalPosts} posts</span>
        </div>
      ) : null}

      {/* Volunteer share library */}
      <section>
        <h2 className="section-h">Share to your channels</h2>
        <p className="note">
          Pick a post, copy it or open your platform's composer, then mark it
          shared. You're posting to your own account — approved, compliant copy.
        </p>
        {!posts ? (
          <p className="note">Loading posts…</p>
        ) : posts.length === 0 ? (
          <p className="note">No approved posts for this phase yet.</p>
        ) : (
          posts.map((p) => <ShareCard key={p.id} post={p} onShared={bumpShare} />)
        )}
      </section>

      {/* Authoring (Social & Comms Clerk) */}
      {has("comms.draft") ? <Authoring onSaved={load} /> : null}

      {/* Pending queue: compliance acts, drafters watch their drafts' status */}
      {has("comms.approve") || has("comms.draft") ? (
        <Approvals posts={pending} canApprove={has("comms.approve")} onChanged={load} />
      ) : null}
    </div>
  );
}
