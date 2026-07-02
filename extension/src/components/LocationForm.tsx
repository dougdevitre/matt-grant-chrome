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

  // Device coordinates from "use my current location". Present only while the
  // filled county/ZIP still come from that detected point; any manual edit to
  // county or ZIP clears it so we never send stale coordinates.
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoNote, setGeoNote] = useState<string | null>(null);

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

  // Changing county invalidates the previously-picked district + ZIP, and means
  // the user is overriding any detected location.
  function onCountyChange(next: string) {
    setCounty(next);
    setSchoolDistrict("");
    setZip("");
    setCoords(null);
  }

  // A manual ZIP edit also overrides the detected location (district is a
  // sub-selection of the same point, so it does not clear coords).
  function onZipChange(next: string) {
    setZip(next);
    setCoords(null);
  }

  // "Use my current location": get the device coordinates, reverse-geocode them
  // to county/ZIP/(district), and pre-fill the selectors. Auto-submits only when
  // it yields a complete, consistent selection; otherwise it fills what it can
  // and asks the user to finish. Any failure/denial falls back to manual entry.
  function detectMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoNote("Location isn't available on this device — enter it below.");
      return;
    }
    setGeoBusy(true);
    setGeoNote(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        try {
          const g = await api.reverseGeocode(lat, lng);
          const nextCounty = g.county ?? "";
          const matchedCounty = options?.counties.find((c) => c.county === nextCounty);
          const matchedDistrict =
            (g.schoolDistrict &&
              matchedCounty?.schoolDistricts.find((d) => d.name === g.schoolDistrict)
                ?.name) ||
            "";
          const nextZip = g.zip ?? "";
          if (nextCounty) setCounty(nextCounty);
          setSchoolDistrict(matchedDistrict);
          if (nextZip) setZip(nextZip);
          setCoords({ lat, lng });
          if (g.inDistrict === false) {
            setGeoNote("Your location looks outside MO-02 — double-check, or continue anyway.");
          } else if (!matchedDistrict) {
            setGeoNote("Filled in your area — pick your school district, then tap Show my info.");
          }
          if (nextCounty && matchedDistrict && /^\d{5}$/.test(nextZip)) {
            onResolve({
              county: nextCounty,
              schoolDistrict: matchedDistrict,
              zip: nextZip,
              address: address?.trim() || null,
              coords: { lat, lng },
            });
          }
        } catch {
          setGeoNote("Couldn't look up your location — enter it below.");
        } finally {
          setGeoBusy(false);
        }
      },
      () => {
        setGeoBusy(false);
        setGeoNote("Location permission was denied — enter it below.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }

  const zipValid = /^\d{5}$/.test(zip);
  const canSubmit = !!county.trim() && !!schoolDistrict.trim() && zipValid && !busy;

  return (
    <div className="form">
      <button
        className="btn secondary geo-btn"
        disabled={busy || geoBusy}
        onClick={detectMyLocation}
      >
        {geoBusy ? "Locating…" : "📍 Use my current location"}
      </button>
      {geoNote ? <div className="note">{geoNote}</div> : null}

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
              onChange={(e) => onZipChange(e.target.value)}
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
              onChange={(e) => onZipChange(e.target.value.replace(/\D/g, "").slice(0, 5))}
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
            coords,
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
