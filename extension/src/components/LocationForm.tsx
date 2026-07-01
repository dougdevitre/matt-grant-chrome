import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import type { LocationInput, LocationOptions } from "../lib/types.js";

// No HTML <form> element — uses button onClick per environment constraints.
//
// County / School district / ZIP are chosen from cascading dropdowns sourced
// from the MO-02 reference dataset (GET /location/options): picking a County
// filters the School district and ZIP options to that county, so a clerk can
// only submit a real, internally-consistent selection. If the options fail to
// load, the form falls back to the original free-text inputs so it never breaks.
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

  const [options, setOptions] = useState<LocationOptions | null>(null);
  const [optionsFailed, setOptionsFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .locationOptions()
      .then((o) => {
        if (!cancelled) setOptions(o);
      })
      .catch(() => {
        if (!cancelled) setOptionsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const useSelectors = !!options && options.counties.length > 0 && !optionsFailed;
  const selectedCounty = useMemo(
    () => options?.counties.find((c) => c.county === county) ?? null,
    [options, county]
  );

  // Changing county invalidates the previously-picked district + ZIP.
  function onCountyChange(next: string) {
    setCounty(next);
    setSchoolDistrict("");
    setZip("");
  }

  const zipValid = /^\d{5}$/.test(zip);
  const canSubmit = !!county.trim() && !!schoolDistrict.trim() && zipValid && !busy;

  return (
    <div className="form">
      <label>
        County
        {useSelectors ? (
          <select
            className="select"
            value={county}
            onChange={(e) => onCountyChange(e.target.value)}
          >
            <option value="">Select your county…</option>
            {options!.counties.map((c) => (
              <option key={c.county} value={c.county}>
                {c.county}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={county}
            onChange={(e) => setCounty(e.target.value)}
            placeholder="e.g. St. Louis"
          />
        )}
      </label>

      <label>
        School district
        {useSelectors ? (
          <select
            className="select"
            value={schoolDistrict}
            onChange={(e) => setSchoolDistrict(e.target.value)}
            disabled={!selectedCounty}
          >
            <option value="">
              {selectedCounty ? "Select your district…" : "Pick a county first"}
            </option>
            {(selectedCounty?.schoolDistricts ?? []).map((sd) => (
              <option key={sd.leaId} value={sd.name}>
                {sd.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={schoolDistrict}
            onChange={(e) => setSchoolDistrict(e.target.value)}
            placeholder="e.g. Hazelwood"
          />
        )}
      </label>

      <div className="row">
        <label>
          ZIP code
          {useSelectors ? (
            <select
              className="select"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              disabled={!selectedCounty}
            >
              <option value="">{selectedCounty ? "Select…" : "—"}</option>
              {(selectedCounty?.zips ?? []).map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
              inputMode="numeric"
              placeholder="63031"
            />
          )}
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
      {!useSelectors && zip && !zipValid ? (
        <div className="note">Enter a 5-digit ZIP code.</div>
      ) : null}
    </div>
  );
}
