import { useState } from "react";
import type { LocationInput } from "../lib/types.js";

// No HTML <form> element — uses button onClick per environment constraints.
export function LocationForm({
  initial,
  onResolve,
  busy,
}: {
  initial?: Partial<LocationInput>;
  onResolve: (input: LocationInput) => void;
  busy: boolean;
}) {
  const [county, setCounty] = useState(initial?.county ?? "");
  const [schoolDistrict, setSchoolDistrict] = useState(
    initial?.schoolDistrict ?? ""
  );
  const [zip, setZip] = useState(initial?.zip ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");

  const zipValid = /^\d{5}$/.test(zip);
  const canSubmit = county.trim() && schoolDistrict.trim() && zipValid && !busy;

  return (
    <div className="form">
      <label>
        County
        <input
          value={county}
          onChange={(e) => setCounty(e.target.value)}
          placeholder="e.g. St. Louis"
        />
      </label>
      <label>
        School district
        <input
          value={schoolDistrict}
          onChange={(e) => setSchoolDistrict(e.target.value)}
          placeholder="e.g. Hazelwood"
        />
      </label>
      <div className="row">
        <label>
          ZIP code
          <input
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
            inputMode="numeric"
            placeholder="63031"
          />
        </label>
        <label>
          Address <span className="note">(optional)</span>
          <input
            value={address ?? ""}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="for exact polling place"
          />
        </label>
      </div>
      <button
        className="btn"
        disabled={!canSubmit}
        onClick={() =>
          onResolve({
            county: county.trim(),
            schoolDistrict: schoolDistrict.trim(),
            zip,
            address: address?.trim() || null,
          })
        }
      >
        {busy ? "Finding your info…" : "Show my info"}
      </button>
      {zip && !zipValid ? (
        <div className="note">Enter a 5-digit ZIP code.</div>
      ) : null}
    </div>
  );
}
