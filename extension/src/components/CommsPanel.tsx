import { useEffect, useState } from "react";
import { api, stepUp, authMode } from "../lib/api.js";
import { messageForError } from "../lib/errors.js";
import type { ClerkIdentity, MessageTemplate } from "../lib/types.js";

function statusOf(t: MessageTemplate): "approved" | "pending" | "needs_fix" {
  if (t.complianceApprovalId) return "approved";
  if (!t.hasDisclaimer || !t.hasOptOut) return "needs_fix";
  return "pending";
}

export function CommsPanel({ me }: { me: ClerkIdentity }) {
  const has = (s: string) => me.scopes.includes(s as never);
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // draft form
  const [category, setCategory] = useState("register");
  const [channel, setChannel] = useState("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  // send form
  const [sendTemplateId, setSendTemplateId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [stepCode, setStepCode] = useState("");
  const [sendMsg, setSendMsg] = useState<string | null>(null);

  // batch send (to not-yet-voted)
  const [batchTemplateId, setBatchTemplateId] = useState("");
  const [batchZip, setBatchZip] = useState("");
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);

  const isAdmin = me.scopes.includes("sms.send" as never);
  const [mode, setMode] = useState<"dev" | "clerk">("dev");
  useEffect(() => {
    authMode().then(setMode);
  }, []);

  async function load() {
    try {
      setTemplates(await api.templates());
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "action_failed");
    } finally {
      setBusyId(null);
    }
  }

  async function draft() {
    setError(null);
    try {
      await api.createTemplate({
        category,
        channel,
        subject: subject || null,
        body,
      });
      setSubject("");
      setBody("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "draft_failed");
    }
  }

  async function doSend() {
    setSendMsg(null);
    setError(null);
    try {
      const idempotencyKey = `${sendTemplateId}::${recipient.trim().toLowerCase()}`;
      const tpl = (templates ?? []).find((t) => t.id === sendTemplateId);
      let stepUpToken: string | undefined;
      if (tpl?.channel === "sms") {
        // SMS is admin-only and requires step-up re-auth.
        if (!isAdmin) {
          setError("SMS sending is restricted to admins.");
          return;
        }
        // Dev re-presents the access code; Clerk re-presents the stored session token.
        stepUpToken = await stepUp(mode === "dev" ? stepCode : undefined);
      }
      await api.send(sendTemplateId, recipient.trim(), idempotencyKey, stepUpToken);
      setSendMsg("Sent.");
      setRecipient("");
      setStepCode("");
    } catch (e) {
      setSendMsg(null);
      setError(messageForError(e instanceof Error ? e.message : "send_failed"));
    }
  }

  // Non-admins can't even select SMS templates to send.
  const sendable = (list: MessageTemplate[]) =>
    isAdmin ? list : list.filter((t) => t.channel !== "sms");
  const selectedTpl = (templates ?? []).find((t) => t.id === sendTemplateId);

  const approved = (templates ?? []).filter((t) => t.complianceApprovalId);
  const pending = (templates ?? []).filter((t) => !t.complianceApprovalId);
  // Batch only sends email/social — SMS's per-message step-up isn't run here.
  const batchable = approved.filter((t) => t.channel !== "sms");

  async function doBatch() {
    setBatchBusy(true);
    setError(null);
    setBatchMsg(null);
    try {
      const r = await api.sendBatch({
        templateId: batchTemplateId,
        zip: batchZip.trim() || null,
      });
      setBatchMsg(
        `Sent ${r.sent} of ${r.attempted}` +
          (r.blocked ? `, ${r.blocked} blocked` : "") +
          (r.failed ? `, ${r.failed} failed` : "") +
          (r.truncated ? " (capped at 200)" : "") +
          "."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "batch_failed");
    } finally {
      setBatchBusy(false);
    }
  }

  return (
    <div className="panel">
      {error ? <div className="warn">{error}</div> : null}

      {/* Compliance review */}
      {has("comms.approve") ? (
        <section>
          <h2 className="section-h">Pending review ({pending.length})</h2>
          {pending.length === 0 ? (
            <p className="note">Nothing waiting.</p>
          ) : (
            pending.map((t) => (
              <div className="card" key={t.id}>
                <span className="src">{t.category}</span>
                <h3>{t.subject ?? "(no subject)"}</h3>
                <p>{t.body}</p>
                <div className="checks">
                  <span className={t.hasDisclaimer ? "chk ok" : "chk bad"}>
                    disclaimer
                  </span>
                  <span className={t.hasOptOut ? "chk ok" : "chk bad"}>opt-out</span>
                </div>
                <div className="task-actions">
                  <button
                    className="btn"
                    disabled={busyId === t.id || !t.hasDisclaimer || !t.hasOptOut}
                    onClick={() => act(t.id, () => api.approveTemplate(t.id, true))}
                  >
                    Approve
                  </button>
                  <button
                    className="btn secondary"
                    disabled={busyId === t.id}
                    onClick={() => act(t.id, () => api.approveTemplate(t.id, false))}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      ) : null}

      {/* Draft */}
      {has("comms.draft") ? (
        <section>
          <h2 className="section-h">Draft a template</h2>
          <div className="form">
            <div className="row">
              <label>
                Category
                <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="register">register</option>
                  <option value="plan">plan</option>
                  <option value="turnout">turnout</option>
                </select>
              </label>
              <label>
                Channel
                <select className="select" value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="email">email</option>
                  <option value="sms">sms</option>
                  <option value="social">social</option>
                </select>
              </label>
            </div>
            <label>
              Subject
              <input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label>
              Body
              <textarea
                className="textarea"
                value={body}
                placeholder="Include 'Paid for by …' and 'Reply STOP to opt out'."
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <button className="btn" disabled={!body.trim()} onClick={draft}>
              Save draft
            </button>
            <p className="note">
              Disclaimer + opt-out are detected automatically and required before
              approval.
            </p>
          </div>
        </section>
      ) : null}

      {/* Send */}
      {has("comms.send") ? (
        <section>
          <h2 className="section-h">Send</h2>
          {sendable(approved).length === 0 ? (
            <p className="note">No approved templates available to you.</p>
          ) : (
            <div className="form">
              <label>
                Template
                <select
                  className="select"
                  value={sendTemplateId}
                  onChange={(e) => setSendTemplateId(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {sendable(approved).map((t) => (
                    <option key={t.id} value={t.id}>
                      [{t.category}/{t.channel}] {t.subject ?? t.id.slice(0, 6)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Recipient ({selectedTpl?.channel === "sms" ? "phone" : "email"})
                <input value={recipient} onChange={(e) => setRecipient(e.target.value)} />
              </label>
              {selectedTpl?.channel === "sms" ? (
                <>
                  <div className="warn">
                    SMS is admin-only and audited.{" "}
                    {mode === "dev"
                      ? "Re-enter your access code to authorize this send."
                      : "Your session re-authorizes this send."}
                  </div>
                  {mode === "dev" ? (
                    <label>
                      Access code
                      <input
                        type="password"
                        value={stepCode}
                        onChange={(e) => setStepCode(e.target.value)}
                      />
                    </label>
                  ) : null}
                </>
              ) : null}
              <button
                className="btn"
                disabled={
                  !sendTemplateId ||
                  !recipient.trim() ||
                  (selectedTpl?.channel === "sms" && mode === "dev" && !stepCode.trim())
                }
                onClick={doSend}
              >
                Send
              </button>
              {sendMsg ? <div className="ok-note">{sendMsg}</div> : null}
            </div>
          )}
        </section>
      ) : null}

      {/* Batch send to not-yet-voted */}
      {has("comms.send") ? (
        <section>
          <h2 className="section-h">Batch: not-yet-voted</h2>
          {batchable.length === 0 ? (
            <p className="note">No approved email/social templates available.</p>
          ) : (
            <div className="form">
              <label>
                Template
                <select
                  className="select"
                  value={batchTemplateId}
                  onChange={(e) => setBatchTemplateId(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {batchable.map((t) => (
                    <option key={t.id} value={t.id}>
                      [{t.category}/{t.channel}] {t.subject ?? t.id.slice(0, 6)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                ZIP (optional)
                <input
                  value={batchZip}
                  onChange={(e) => setBatchZip(e.target.value)}
                  placeholder="e.g. 63031"
                />
              </label>
              <button
                className="btn"
                disabled={!batchTemplateId || batchBusy}
                onClick={doBatch}
              >
                Send to not-yet-voted
              </button>
              <p className="note">
                Skips anyone who already voted or opted out. SMS isn't sent in batch.
                Capped at 200.
              </p>
              {batchMsg ? <div className="ok-note">{batchMsg}</div> : null}
            </div>
          )}
        </section>
      ) : null}

      {/* All templates */}
      <section>
        <h2 className="section-h">All templates</h2>
        {!templates ? (
          <p className="note">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="note">None yet.</p>
        ) : (
          templates.map((t) => (
            <div className="trow" key={t.id}>
              <span>
                [{t.category}] {t.subject ?? t.id.slice(0, 6)}
              </span>
              <span className={`tag ${statusOf(t)}`}>{statusOf(t)}</span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
