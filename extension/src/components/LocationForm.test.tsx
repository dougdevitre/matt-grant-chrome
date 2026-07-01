// LocationForm uses cascading dropdowns from GET /location/options: picking a
// County filters the School district + ZIP options, and submit passes the exact
// selected strings. If options fail to load it falls back to free-text inputs.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocationForm } from "./LocationForm.js";
import { api } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({ api: { locationOptions: vi.fn() } }));

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
