import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { messageForError } from "../lib/errors.js";
import type { Contact, ImportPreview } from "../lib/types.js";
import { ContactDetail } from "./ContactDetail.js";

const SAMPLE = "firstName,lastName,email,phone,address,city,zip\n";

const PAGE_SIZE = 25;

export function ImportPanel({ canRead }: { canRead: boolean }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [total, setTotal] = useState(0);
  const [notVoted, setNotVoted] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<
    { row: number; reason: string }[]
  >([]);
  const [addOpen, setAddOpen] = useState(false);
  const [add, setAdd] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    zip: "",
  });

  // Load one page; offset 0 replaces the list (fresh load), otherwise appends.
  async function loadContacts(offset = 0, onlyNotVoted = notVoted) {
    if (!canRead) return;
    try {
      const page = await api.contactsPage({
        limit: PAGE_SIZE,
        offset,
        notVoted: onlyNotVoted,
      });
      setTotal(page.total);
      setContacts((prev) =>
        offset === 0 ? page.items : [...(prev ?? []), ...page.items]
      );
    } catch {
      /* contacts list is optional; ignore */
    }
  }

  function toggleNotVoted(next: boolean) {
    setNotVoted(next);
    loadContacts(0, next);
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
    setImportErrors([]);
    try {
      const r = await api.importCommit(csv);
      const errNote = r.errors.length ? `, ${r.errors.length} couldn't import` : "";
      setMsg(`Imported ${r.created}, skipped ${r.skipped}${errNote}.`);
      setImportErrors(r.errors);
      setPreview(null);
      setCsv("");
      await loadContacts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "commit_failed");
    } finally {
      setBusy(false);
    }
  }

  async function doAddContact() {
    if (!add.firstName.trim() || !add.lastName.trim()) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const c = await api.addContact({
        firstName: add.firstName.trim(),
        lastName: add.lastName.trim(),
        phone: add.phone.trim() || undefined,
        email: add.email.trim() || undefined,
        address: add.address.trim() || undefined,
        city: add.city.trim() || undefined,
        zip: add.zip.trim() || undefined,
      });
      setMsg(`Added ${c.firstName} ${c.lastName}.`);
      setAdd({ firstName: "", lastName: "", phone: "", email: "", address: "", city: "", zip: "" });
      setAddOpen(false);
      await loadContacts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "add_failed");
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

      {error ? <div className="warn" role="alert">{messageForError(error)}</div> : null}
      {msg ? <div className="ok-note">{msg}</div> : null}
      {importErrors.length ? (
        <div className="warn" role="alert">
          <strong>Didn't import — fix and re-import:</strong>
          <ul>
            {importErrors.slice(0, 10).map((e) => (
              <li key={e.row}>Row {e.row}: {e.reason}</li>
            ))}
          </ul>
          {importErrors.length > 10 ? (
            <p className="note">+{importErrors.length - 10} more</p>
          ) : null}
        </div>
      ) : null}

      <div className="add-one">
        <button className="linklike" onClick={() => setAddOpen((v) => !v)}>
          {addOpen ? "Cancel" : "+ Add one contact"}
        </button>
        {addOpen ? (
          <div className="form">
            <div className="row">
              <input
                placeholder="First name"
                value={add.firstName}
                onChange={(e) => setAdd({ ...add, firstName: e.target.value })}
              />
              <input
                placeholder="Last name"
                value={add.lastName}
                onChange={(e) => setAdd({ ...add, lastName: e.target.value })}
              />
            </div>
            <div className="row">
              <input
                placeholder="Phone"
                value={add.phone}
                onChange={(e) => setAdd({ ...add, phone: e.target.value })}
              />
              <input
                placeholder="Email"
                value={add.email}
                onChange={(e) => setAdd({ ...add, email: e.target.value })}
              />
            </div>
            <input
              placeholder="Address"
              value={add.address}
              onChange={(e) => setAdd({ ...add, address: e.target.value })}
            />
            <div className="row">
              <input
                placeholder="City"
                value={add.city}
                onChange={(e) => setAdd({ ...add, city: e.target.value })}
              />
              <input
                placeholder="ZIP"
                value={add.zip}
                onChange={(e) => setAdd({ ...add, zip: e.target.value })}
              />
            </div>
            <button
              className="btn"
              disabled={busy || !add.firstName.trim() || !add.lastName.trim()}
              onClick={doAddContact}
            >
              Add contact
            </button>
            <p className="note">
              Needs a phone or email. Skipped if they already exist or opted out.
            </p>
          </div>
        ) : null}
      </div>

      {preview ? (
        <div className="preview">
          <div className="counts">
            <span className="pill done">{preview.counts.new} new</span>
            <span className="pill">{preview.counts.duplicate} dup</span>
            <span className="pill">{preview.counts.invalid} invalid</span>
            <span className="pill">{preview.counts.out_of_district} out-of-dist</span>
            <span className="pill">{preview.counts.suppressed} opted-out</span>
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
          <h2 className="section-h">
            Contacts ({contacts.length}
            {total > contacts.length ? ` of ${total}` : ""})
          </h2>
          <label className="note filter-toggle">
            <input
              type="checkbox"
              checked={notVoted}
              onChange={(e) => toggleNotVoted(e.target.checked)}
            />{" "}
            Not yet voted (GOTV)
          </label>
          {contacts.map((c) => (
            <div key={c.id}>
              <div
                className="contact contact-row"
                role="button"
                tabIndex={0}
                aria-expanded={openId === c.id}
                onClick={() => setOpenId((id) => (id === c.id ? null : c.id))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenId((id) => (id === c.id ? null : c.id));
                  }
                }}
              >
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
              {openId === c.id ? (
                <ContactDetail contact={c} onChanged={() => loadContacts(0)} />
              ) : null}
            </div>
          ))}
          {contacts.length < total ? (
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => loadContacts(contacts.length)}
            >
              Load more
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
