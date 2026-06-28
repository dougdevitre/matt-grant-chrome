import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { Contact, ImportPreview } from "../lib/types.js";

const SAMPLE = "firstName,lastName,email,phone,address,city,zip\n";

export function ImportPanel({ canRead }: { canRead: boolean }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);

  async function loadContacts() {
    if (!canRead) return;
    try {
      setContacts(await api.contacts());
    } catch {
      /* contacts list is optional; ignore */
    }
  }

  useEffect(() => {
    loadContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function readFile(file: File) {
    setCsv(await file.text());
    setPreview(null);
    setMsg(null);
  }

  async function doPreview() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      setPreview(await api.importPreview(csv));
    } catch (e) {
      setError(e instanceof Error ? e.message : "preview_failed");
    } finally {
      setBusy(false);
    }
  }

  async function doCommit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.importCommit(csv);
      setMsg(`Imported ${r.created}, skipped ${r.skipped}.`);
      setPreview(null);
      setCsv("");
      await loadContacts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "commit_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2 className="section-h">Import contacts</h2>
      <p className="note">
        Paste CSV or choose a file. Columns: first/last name, email, phone,
        address, city, zip.
      </p>
      <textarea
        className="textarea"
        value={csv}
        placeholder={SAMPLE}
        onChange={(e) => {
          setCsv(e.target.value);
          setPreview(null);
        }}
      />
      <div className="row-actions">
        <input
          type="file"
          accept=".csv,text/csv"
          className="file"
          onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
        />
        <button className="btn" disabled={!csv.trim() || busy} onClick={doPreview}>
          Preview
        </button>
      </div>

      {error ? <div className="warn">{error}</div> : null}
      {msg ? <div className="ok-note">{msg}</div> : null}

      {preview ? (
        <div className="preview">
          <div className="counts">
            <span className="pill done">{preview.counts.new} new</span>
            <span className="pill">{preview.counts.duplicate} dup</span>
            <span className="pill">{preview.counts.invalid} invalid</span>
            <span className="pill">{preview.counts.out_of_district} out-of-dist</span>
          </div>
          <div className="preview-rows">
            {preview.rows.slice(0, 8).map((r, i) => (
              <div className="prow" key={i}>
                <span>
                  {r.firstName} {r.lastName}
                </span>
                <span className={`tag ${r.status}`}>{r.status}</span>
              </div>
            ))}
            {preview.rows.length > 8 ? (
              <p className="note">+{preview.rows.length - 8} more</p>
            ) : null}
          </div>
          <button
            className="btn"
            disabled={preview.counts.new === 0 || busy}
            onClick={doCommit}
          >
            Import {preview.counts.new} new contact
            {preview.counts.new === 1 ? "" : "s"}
          </button>
        </div>
      ) : null}

      {canRead && contacts ? (
        <div className="contacts">
          <h2 className="section-h">Contacts ({contacts.length})</h2>
          {contacts.map((c) => (
            <div className="contact" key={c.id}>
              <div>
                <strong>
                  {c.firstName} {c.lastName}
                </strong>
                <span className="note">
                  {" "}
                  {c.zip ?? ""} {c.email ?? c.phone ?? ""}
                </span>
              </div>
              <span className={`tag ${c.regStatus}`}>{c.regStatus}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
