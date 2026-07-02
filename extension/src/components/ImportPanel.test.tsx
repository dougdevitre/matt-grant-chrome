import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportPanel } from "./ImportPanel.js";
import { api } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  api: {
    contactsPage: vi.fn(),
    importPreview: vi.fn(),
    importCommit: vi.fn(),
    addContact: vi.fn(),
  },
}));

const preview = {
  total: 2,
  counts: { new: 2, duplicate: 0, invalid: 0, out_of_district: 0, suppressed: 0 },
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
    vi.mocked(api.importCommit).mockResolvedValue({
      created: 2,
      skipped: 0,
      contactIds: [],
      errors: [],
    } as never);
    render(<ImportPanel canRead={false} />);

    await userEvent.type(screen.getByRole("textbox"), "first,last\nJo,Pierce");
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("2 new");
    await userEvent.click(screen.getByRole("button", { name: /Import 2 new contacts/ }));

    expect(api.importCommit).toHaveBeenCalled();
    expect(await screen.findByText("Imported 2, skipped 0.")).toBeInTheDocument();
  });

  it("shows a per-row error list when some rows don't import", async () => {
    vi.mocked(api.importPreview).mockResolvedValue(preview as never);
    vi.mocked(api.importCommit).mockResolvedValue({
      created: 1,
      skipped: 1,
      contactIds: ["c1"],
      errors: [{ row: 3, reason: "missing name" }],
    } as never);
    render(<ImportPanel canRead={false} />);

    await userEvent.type(screen.getByRole("textbox"), "first,last\nJo,Pierce");
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("2 new");
    await userEvent.click(screen.getByRole("button", { name: /Import 2 new contacts/ }));

    expect(await screen.findByText(/Row 3: missing name/)).toBeInTheDocument();
  });

  it("adds a single contact through the quick-add form", async () => {
    vi.mocked(api.addContact).mockResolvedValue({
      id: "c9",
      firstName: "Sam",
      lastName: "Rivera",
    } as never);
    render(<ImportPanel canRead={false} />);

    await userEvent.click(screen.getByRole("button", { name: /\+ Add one contact/ }));
    await userEvent.type(screen.getByPlaceholderText("First name"), "Sam");
    await userEvent.type(screen.getByPlaceholderText("Last name"), "Rivera");
    await userEvent.type(screen.getByPlaceholderText("Phone"), "3145551212");
    await userEvent.click(screen.getByRole("button", { name: "Add contact" }));

    expect(api.addContact).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Sam", lastName: "Rivera", phone: "3145551212" })
    );
    expect(await screen.findByText("Added Sam Rivera.")).toBeInTheDocument();
  });

  it("lists existing contacts when the clerk can read them", async () => {
    vi.mocked(api.contactsPage).mockResolvedValue({
      items: [
        { id: "c1", firstName: "Avery", lastName: "Nguyen", zip: "63031", email: null, phone: "+1314", regStatus: "registered" },
      ],
      total: 1,
    } as never);
    render(<ImportPanel canRead={true} />);
    expect(await screen.findByText("Avery", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("registered")).toBeInTheDocument();
  });
});
