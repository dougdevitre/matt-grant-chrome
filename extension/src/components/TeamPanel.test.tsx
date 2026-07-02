import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamPanel } from "./TeamPanel.js";
import { api } from "../lib/api.js";
import type { ClerkIdentity } from "../lib/types.js";

vi.mock("../lib/api.js", () => ({
  api: {
    team: vi.fn(),
    volunteerWork: vi.fn(),
    tasks: vi.fn(),
    assignTask: vi.fn(),
    inviteVolunteer: vi.fn(),
    removeVolunteer: vi.fn(),
    nudgeVolunteer: vi.fn(),
  },
}));

const captain = {
  clerkId: "cap-1",
  role: "team_captain",
  scopes: ["team.read", "team.manage", "task.read"],
} as ClerkIdentity;

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

const emptyWork = { volunteer: roster[0], tasks: [], shifts: [], recentActivity: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.tasks).mockResolvedValue([] as never);
});

describe("TeamPanel", () => {
  it("renders the roster and expands a volunteer's work on click", async () => {
    vi.mocked(api.team).mockResolvedValue(roster as never);
    vi.mocked(api.volunteerWork).mockResolvedValue({
      ...emptyWork,
      tasks: [{ id: "t1", title: "Call voters", status: "claimed" }],
    } as never);
    render(<TeamPanel me={captain} />);

    await userEvent.click(await screen.findByText("Val One"));

    expect(api.volunteerWork).toHaveBeenCalledWith("vol-1");
    expect(await screen.findByText("Call voters")).toBeInTheDocument();
  });

  it("lets a captain assign an open task to a volunteer", async () => {
    vi.mocked(api.team).mockResolvedValue(roster as never);
    vi.mocked(api.volunteerWork).mockResolvedValue(emptyWork as never);
    vi.mocked(api.tasks).mockResolvedValue([
      { id: "t9", title: "Knock doors", status: "open" },
    ] as never);
    vi.mocked(api.assignTask).mockResolvedValue({ id: "t9" } as never);
    render(<TeamPanel me={captain} />);

    await userEvent.click(await screen.findByText("Val One"));
    await userEvent.selectOptions(
      await screen.findByRole("combobox"),
      "t9"
    );
    await userEvent.click(screen.getByRole("button", { name: "Assign" }));

    expect(api.assignTask).toHaveBeenCalledWith("vol-1", "t9");
  });

  it("hides the assign control for a read-only captain", async () => {
    vi.mocked(api.team).mockResolvedValue(roster as never);
    vi.mocked(api.volunteerWork).mockResolvedValue(emptyWork as never);
    const readOnly = { ...captain, scopes: ["team.read"] } as ClerkIdentity;
    render(<TeamPanel me={readOnly} />);

    await userEvent.click(await screen.findByText("Val One"));
    await screen.findByText(/Recent activity/);
    expect(screen.queryByRole("button", { name: "Assign" })).not.toBeInTheDocument();
  });

  it("shows an empty state when the roster is empty", async () => {
    vi.mocked(api.team).mockResolvedValue([] as never);
    render(<TeamPanel me={captain} />);
    expect(await screen.findByText(/No volunteers on your roster/i)).toBeInTheDocument();
  });

  it("shows a friendly error when the roster fails to load", async () => {
    vi.mocked(api.team).mockRejectedValue(new Error("boom"));
    render(<TeamPanel me={captain} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("invites a volunteer by name + email", async () => {
    vi.mocked(api.team).mockResolvedValue([] as never);
    vi.mocked(api.inviteVolunteer).mockResolvedValue({ id: "m9" } as never);
    render(<TeamPanel me={captain} />);
    await screen.findByText(/No volunteers on your roster/i);

    await userEvent.type(screen.getByPlaceholderText("Volunteer name"), "Sam Rivera");
    await userEvent.type(screen.getByPlaceholderText("Email"), "sam@x.co");
    await userEvent.click(screen.getByRole("button", { name: "Invite volunteer" }));

    expect(api.inviteVolunteer).toHaveBeenCalledWith({
      displayName: "Sam Rivera",
      email: "sam@x.co",
    });
  });

  it("removes a volunteer without expanding the row", async () => {
    vi.mocked(api.team).mockResolvedValue(roster as never);
    vi.mocked(api.removeVolunteer).mockResolvedValue({ status: "removed" } as never);
    render(<TeamPanel me={captain} />);

    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));

    expect(api.removeVolunteer).toHaveBeenCalledWith("m1");
    expect(api.volunteerWork).not.toHaveBeenCalled(); // row didn't expand
  });

  it("marks a pending (not-yet-signed-in) volunteer and doesn't fetch work", async () => {
    vi.mocked(api.team).mockResolvedValue([
      { ...roster[0], id: "m2", clerkId: null, displayName: "Pending Pat" },
    ] as never);
    render(<TeamPanel me={captain} />);

    expect(await screen.findByText("pending")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Pending Pat"));
    expect(await screen.findByText(/Hasn't signed in yet/i)).toBeInTheDocument();
    expect(api.volunteerWork).not.toHaveBeenCalled();
  });

  it("nudges a volunteer from their detail pane", async () => {
    vi.mocked(api.team).mockResolvedValue(roster as never);
    vi.mocked(api.volunteerWork).mockResolvedValue({
      volunteer: roster[0],
      tasks: [],
      shifts: [],
      recentActivity: [],
    } as never);
    vi.mocked(api.nudgeVolunteer).mockResolvedValue({ sent: true } as never);
    render(<TeamPanel me={captain} />);

    await userEvent.click(await screen.findByText("Val One"));
    await userEvent.type(await screen.findByPlaceholderText("Quick reminder…"), "Claim your shift");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(api.nudgeVolunteer).toHaveBeenCalledWith("vol-1", "Claim your shift");
    expect(await screen.findByText("Reminder sent.")).toBeInTheDocument();
  });
});
