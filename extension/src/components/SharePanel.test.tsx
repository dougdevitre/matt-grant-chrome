import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SharePanel } from "./SharePanel.js";
import { api } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  api: {
    socialPosts: vi.fn(),
    socialDashboard: vi.fn(),
    markShared: vi.fn(),
  },
}));

// A plain volunteer: no comms scopes, so no authoring/approval sections render.
const volunteer = {
  clerkId: "v1",
  role: "voter_contact_clerk",
  scopes: ["voter.read", "contact.log", "task.read", "task.write"],
} as never;

function post(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    blastId: "b1",
    category: "donate",
    phases: ["PHASE_1_REGISTER"],
    title: "Chip in — grassroots ask",
    variants: [
      { platform: "x", text: "Chip in $10 today." },
      { platform: "facebook", text: "Chip in $10 today — longer version." },
    ],
    hashtags: ["#MO02", "#ChipIn"],
    linkUrl: "https://secure.winred.com/x/donate",
    disclaimer: "Paid for by Matt Grant for Congress.",
    hasDisclaimer: true,
    status: "approved",
    complianceApprovalId: "a",
    createdBy: "seed",
    shareCount: 0,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const dashboard = {
  activeBlast: {
    blastId: "b1",
    title: "Chip in for MO-02",
    theme: "Grassroots ask",
    status: "active",
    scheduledFor: "",
    goal: 100,
    shares: 20,
    posts: 1,
  },
  totalShares: 20,
  totalPosts: 1,
  byBlast: [],
  byPlatform: [],
  topPosts: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.socialPosts).mockResolvedValue([post()] as never);
  vi.mocked(api.socialDashboard).mockResolvedValue(dashboard as never);
  vi.mocked(api.markShared).mockResolvedValue({ status: "shared", shareCount: 1 } as never);
});

describe("SharePanel", () => {
  it("shows the active blast progress and a shareable post", async () => {
    render(<SharePanel me={volunteer} phase={null} />);
    expect(await screen.findByText("This week's blast")).toBeInTheDocument();
    expect(screen.getByText(/20 of 100 shares/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chip in — grassroots ask", level: 3 })).toBeInTheDocument();
    // The X (default) variant text renders.
    expect(screen.getByText("Chip in $10 today.")).toBeInTheDocument();
    expect(screen.getByText("#MO02 #ChipIn")).toBeInTheDocument();
  });

  it("switches variant text when another platform chip is chosen", async () => {
    render(<SharePanel me={volunteer} phase={null} />);
    await screen.findByText("Chip in $10 today.");
    await userEvent.click(screen.getByRole("tab", { name: "Facebook" }));
    expect(screen.getByText("Chip in $10 today — longer version.")).toBeInTheDocument();
  });

  it("marks a post shared and bumps the count", async () => {
    render(<SharePanel me={volunteer} phase={null} />);
    const card = (await screen.findByText("Chip in $10 today.")).closest(".share-card")!;
    await userEvent.click(within(card as HTMLElement).getByRole("button", { name: "Mark shared" }));
    expect(api.markShared).toHaveBeenCalledWith("p1", "x");
    expect(await within(card as HTMLElement).findByText("1 shares")).toBeInTheDocument();
  });

  it("requests only posts for the current phase — no fetch-everything fallback", async () => {
    vi.mocked(api.socialPosts).mockResolvedValue([] as never);
    render(<SharePanel me={volunteer} phase={"PHASE_2_PLAN" as never} />);
    expect(
      await screen.findByText("No approved posts for this phase yet.")
    ).toBeInTheDocument();
    expect(api.socialPosts).toHaveBeenCalledWith({ phase: "PHASE_2_PLAN" });
    expect(api.socialPosts).toHaveBeenCalledTimes(1);
  });

  it("hides authoring + approval sections from a non-comms role", async () => {
    render(<SharePanel me={volunteer} phase={null} />);
    await screen.findByText("Share to your channels");
    expect(screen.queryByText("Create a post")).not.toBeInTheDocument();
    expect(screen.queryByText(/Pending review/)).not.toBeInTheDocument();
  });
});

describe("SharePanel drafter visibility", () => {
  const drafter = {
    clerkId: "d1",
    role: "social_comms_clerk",
    scopes: ["comms.draft", "comms.send", "task.read", "task.write"],
  } as never;

  it("shows the pending queue read-only to a drafter (no Approve/Reject)", async () => {
    vi.mocked(api.socialPosts).mockResolvedValue([post({ status: "draft" })] as never);
    render(<SharePanel me={drafter} phase={null} />);
    expect(await screen.findByText(/Pending review/)).toBeInTheDocument();
    expect(screen.getByText("Waiting on a Compliance Clerk.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });
});
