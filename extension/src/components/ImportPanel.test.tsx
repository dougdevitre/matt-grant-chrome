import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportPanel } from "./ImportPanel.js";
import { api } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  api: { contacts: vi.fn(), importPreview: vi.fn(), importCommit: vi.fn() },
}));

const preview = {
  total: 2,
  counts: { new: 2, duplicate: 0, invalid: 0, out_of_district: 0 },
  rows: [
    { firstName: "Jo", lastName: "Pierce", status: "new", reason: null, contactKey: "k1" },
    { firstName: "Al", lastName: "Nguyen", status: "new", reason: null, contactKey: "k2" },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe("ImportPanel", () => {
  it("previews a pasted CSV and shows the counts", async () => {
    vi.mocked(api.importPreview).mockResolvedValue(preview as never);
    render(<ImportPanel canRead={false} />);

    await userEvent.type(screen.getByRole("textbox"), "first,last\nJo,Pierce");
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(api.importPreview).toHaveBeenCalled();
    expect(await screen.findByText("2 new")).toBeInTheDocument();
  });

  it("commits the new rows and reports the result", async () => {
    vi.mocked(api.importPreview).mockResolvedValue(preview as never);
    vi.mocked(api.importCommit).mockResolvedValue({ created: 2, skipped: 0, contactIds: [] } as never);
    render(<ImportPanel canRead={false} />);

    await userEvent.type(screen.getByRole("textbox"), "first,last\nJo,Pierce");
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("2 new");
    await userEvent.click(screen.getByRole("button", { name: /Import 2 new contacts/ }));

    expect(api.importCommit).toHaveBeenCalled();
    expect(await screen.findByText("Imported 2, skipped 0.")).toBeInTheDocument();
  });

  it("lists existing contacts when the clerk can read them", async () => {
    vi.mocked(api.contacts).mockResolvedValue([
      { id: "c1", firstName: "Avery", lastName: "Nguyen", zip: "63031", email: null, phone: "+1314", regStatus: "registered" },
    ] as never);
    render(<ImportPanel canRead={true} />);
    expect(await screen.findByText("Avery", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("registered")).toBeInTheDocument();
  });
});
