import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Scheduler } from "./Scheduler.js";
import { api } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  api: { events: vi.fn(), claimShift: vi.fn(), createEvent: vi.fn(), addShift: vi.fn() },
}));

const me = { clerkId: "c1", role: "events_clerk", scopes: ["voter.read", "task.read"] } as never;

function shift(over: Record<string, unknown> = {}) {
  return {
    id: "s1",
    eventId: "e1",
    role: "Greeter",
    startsAt: "2026-07-02T10:00:00-05:00",
    endsAt: "2026-07-02T12:00:00-05:00",
    capacity: 2,
    claimedBy: [],
    version: 1,
    ...over,
  };
}
function eventWith(shifts: unknown[]) {
  return {
    id: "e1",
    title: "Florissant Drive",
    kind: "registration_drive",
    county: "St. Louis",
    zip: "63031",
    venueName: "Library",
    startsAt: "2026-07-02T10:00:00-05:00",
    endsAt: "2026-07-02T14:00:00-05:00",
    phases: ["PHASE_1_REGISTER"],
    createdBy: "seed",
    createdAt: "",
    shifts,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("Scheduler", () => {
  it("claims an open shift with its version", async () => {
    vi.mocked(api.events).mockResolvedValue([eventWith([shift()])] as never);
    vi.mocked(api.claimShift).mockResolvedValue(shift({ claimedBy: ["c1"] }) as never);
    render(<Scheduler me={me} county="St. Louis" zip="63031" />);

    await screen.findByText("Florissant Drive");
    await userEvent.click(screen.getByRole("button", { name: "Claim shift" }));
    expect(api.claimShift).toHaveBeenCalledWith("s1", 1);
  });

  it("marks a shift I've claimed and disables a full one", async () => {
    vi.mocked(api.events).mockResolvedValue([
      eventWith([
        shift({ id: "mine", claimedBy: ["c1"] }),
        shift({ id: "full", role: "Table", capacity: 1, claimedBy: ["x"] }),
      ]),
    ] as never);
    render(<Scheduler me={me} county={null} zip={null} />);

    await screen.findByText("Florissant Drive");
    expect(screen.getByText("claimed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Full" })).toBeDisabled();
  });

  it("shows the empty state when there are no events", async () => {
    vi.mocked(api.events).mockResolvedValue([] as never);
    render(<Scheduler me={me} county="St. Louis" zip={null} />);
    expect(await screen.findByText(/No events for this phase/i)).toBeInTheDocument();
  });
});

describe("event management (events.write)", () => {
  const eventsClerk = {
    clerkId: "c2",
    role: "events_clerk",
    scopes: ["events.write", "voter.read", "task.read"],
  } as never;

  it("shows Create event + Add shift to an events clerk", async () => {
    vi.mocked(api.events).mockResolvedValue([eventWith([shift()])] as never);
    render(<Scheduler me={eventsClerk} county={null} zip={null} />);
    expect(await screen.findByRole("button", { name: "Create event" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add shift" })).toBeInTheDocument();
  });

  it("offers Create event even when no events exist yet (the old dead-end)", async () => {
    vi.mocked(api.events).mockResolvedValue([] as never);
    render(<Scheduler me={eventsClerk} county={null} zip={null} />);
    expect(await screen.findByText(/No events for this phase/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create event" })).toBeInTheDocument();
  });

  it("hides creation controls from non-events roles", async () => {
    vi.mocked(api.events).mockResolvedValue([eventWith([shift()])] as never);
    render(<Scheduler me={me} county={null} zip={null} />);
    await screen.findByText("Florissant Drive");
    expect(screen.queryByRole("button", { name: "Create event" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add shift" })).not.toBeInTheDocument();
  });

  it("submits a new event and reloads the schedule", async () => {
    vi.mocked(api.events).mockResolvedValue([] as never);
    vi.mocked(api.createEvent).mockResolvedValue({} as never);
    render(<Scheduler me={eventsClerk} county={"St. Louis"} zip={null} />);
    await userEvent.click(await screen.findByRole("button", { name: "Create event" }));
    await userEvent.type(screen.getByLabelText("Title"), "Weekend canvass");
    fireEvent.change(screen.getByLabelText("Starts"), {
      target: { value: "2026-07-18T10:00" },
    });
    fireEvent.change(screen.getByLabelText("Ends"), {
      target: { value: "2026-07-18T14:00" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save event" }));
    expect(api.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Weekend canvass", kind: "canvass", county: "St. Louis" })
    );
    expect(api.events).toHaveBeenCalledTimes(2); // initial load + reload after save
  });
});
