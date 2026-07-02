import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamPanel } from "./TeamPanel.js";
import { api } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({ api: { team: vi.fn(), volunteerWork: vi.fn() } }));

const roster = [
  {
    id: "m1",
    clerkId: "vol-1",
    displayName: "Val One",
    email: "v1@x.co",
    phone: null,
    teamId: "Team A",
    captainClerkId: "cap-1",
    active: true,
    createdAt: "",
    updatedAt: "",
  },
];

beforeEach(() => vi.clearAllMocks());

describe("TeamPanel", () => {
  it("renders the roster and expands a volunteer's work on click", async () => {
    vi.mocked(api.team).mockResolvedValue(roster as never);
    vi.mocked(api.volunteerWork).mockResolvedValue({
      volunteer: roster[0],
      tasks: [{ id: "t1", title: "Call voters", status: "claimed" }],
      shifts: [],
      recentActivity: [],
    } as never);
    render(<TeamPanel />);

    await userEvent.click(await screen.findByText("Val One"));

    expect(api.volunteerWork).toHaveBeenCalledWith("vol-1");
    expect(await screen.findByText("Call voters")).toBeInTheDocument();
  });

  it("shows an empty state when the roster is empty", async () => {
    vi.mocked(api.team).mockResolvedValue([] as never);
    render(<TeamPanel />);
    expect(await screen.findByText(/No volunteers on your roster/i)).toBeInTheDocument();
  });

  it("shows a friendly error when the roster fails to load", async () => {
    vi.mocked(api.team).mockRejectedValue(new Error("boom"));
    render(<TeamPanel />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
