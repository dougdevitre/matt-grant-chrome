// LocationForm uses cascading dropdowns from GET /location/options: picking a
// County filters the School district + ZIP options, and submit passes the exact
// selected strings. If options fail to load it falls back to free-text inputs.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocationForm } from "./LocationForm.js";
import { api } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  api: { locationOptions: vi.fn(), reverseGeocode: vi.fn() },
}));

/** Install a fake navigator.geolocation whose getCurrentPosition runs `impl`. */
function stubGeolocation(
  impl: (success: PositionCallback, error: PositionErrorCallback) => void
) {
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition: impl },
    configurable: true,
  });
}

const OPTIONS = {
  counties: [
    {
      county: "Franklin County",
      schoolDistricts: [
        { name: "Washington School District", leaId: "fra_washington" },
        { name: "Union R-XI", leaId: "fra_union" },
      ],
      zips: ["63090", "63084"],
    },
    {
      county: "Warren County",
      schoolDistricts: [{ name: "Wright City R-II", leaId: "war_wright_city" }],
      zips: ["63390"],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LocationForm selectors", () => {
  it("cascades County → District → ZIP and submits the exact selection", async () => {
    vi.mocked(api.locationOptions).mockResolvedValue(OPTIONS as never);
    const onResolve = vi.fn();
    render(<LocationForm onResolve={onResolve} busy={false} />);

    const countySelect = await screen.findByRole("combobox", { name: /county/i });
    await userEvent.selectOptions(countySelect, "Franklin County");

    // District options are now Franklin's (Warren's district must not appear).
    const districtSelect = screen.getByRole("combobox", { name: /school district/i });
    expect(
      screen.getByRole("option", { name: "Washington School District" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Wright City R-II" })
    ).not.toBeInTheDocument();

    await userEvent.selectOptions(districtSelect, "Washington School District");
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /zip code/i }),
      "63090"
    );

    await userEvent.click(screen.getByRole("button", { name: /show my info/i }));
    expect(onResolve).toHaveBeenCalledWith({
      county: "Franklin County",
      schoolDistrict: "Washington School District",
      zip: "63090",
      address: null,
      coords: null,
    });
  });

  it("falls back to text inputs when options fail to load", async () => {
    vi.mocked(api.locationOptions).mockRejectedValue(new Error("offline"));
    render(<LocationForm onResolve={vi.fn()} busy={false} />);
    // No combobox; the original placeholder inputs render instead.
    expect(await screen.findByPlaceholderText("e.g. St. Louis")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("LocationForm — use my current location", () => {
  it("fills the selectors and auto-submits with coords on a matched location", async () => {
    vi.mocked(api.locationOptions).mockResolvedValue(OPTIONS as never);
    vi.mocked(api.reverseGeocode).mockResolvedValue({
      county: "Franklin County",
      zip: "63090",
      schoolDistrict: "Washington School District",
      inDistrict: true,
      congressionalDistrict: "MO-02",
      censusBlock: "295101234001023",
    });
    stubGeolocation((success) =>
      success({ coords: { latitude: 38.55, longitude: -90.95 } } as GeolocationPosition)
    );
    const onResolve = vi.fn();
    render(<LocationForm onResolve={onResolve} busy={false} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /use my current location/i })
    );

    await vi.waitFor(() =>
      expect(onResolve).toHaveBeenCalledWith({
        county: "Franklin County",
        schoolDistrict: "Washington School District",
        zip: "63090",
        address: null,
        coords: { lat: 38.55, lng: -90.95 },
      })
    );
  });

  it("shows a fallback note and keeps manual entry when permission is denied", async () => {
    vi.mocked(api.locationOptions).mockResolvedValue(OPTIONS as never);
    stubGeolocation((_success, error) =>
      error({ code: 1, message: "denied" } as GeolocationPositionError)
    );
    const onResolve = vi.fn();
    render(<LocationForm onResolve={onResolve} busy={false} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /use my current location/i })
    );

    expect(await screen.findByText(/permission was denied/i)).toBeInTheDocument();
    expect(onResolve).not.toHaveBeenCalled();
    // Manual selectors still usable.
    expect(screen.getByRole("combobox", { name: /county/i })).toBeInTheDocument();
  });
});
