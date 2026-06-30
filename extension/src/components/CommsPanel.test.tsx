import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommsPanel } from "./CommsPanel.js";
import { api, authMode } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  api: {
    templates: vi.fn(),
    createTemplate: vi.fn(),
    approveTemplate: vi.fn(),
    send: vi.fn(),
    sendToContact: vi.fn(),
  },
  stepUp: vi.fn(),
  authMode: vi.fn().mockResolvedValue("dev"),
}));

const admin = {
  clerkId: "a1",
  role: "admin",
  scopes: ["comms.draft", "comms.approve", "comms.send", "sms.send"],
} as never;

function tpl(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    category: "register",
    channel: "sms",
    subject: "GOTV",
    body: "Vote. Paid for by X. Reply STOP.",
    complianceApprovalId: null,
    hasDisclaimer: true,
    hasOptOut: true,
    createdBy: "a1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authMode).mockResolvedValue("dev");
});

describe("CommsPanel", () => {
  it("approves a compliant pending template", async () => {
    vi.mocked(api.templates).mockResolvedValue([tpl()] as never);
    vi.mocked(api.approveTemplate).mockResolvedValue(tpl({ complianceApprovalId: "a" }) as never);
    render(<CommsPanel me={admin} />);

    await screen.findByText("Pending review (1)");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(api.approveTemplate).toHaveBeenCalledWith("t1", true);
  });

  it("asks for an access code on an SMS send in dev mode", async () => {
    vi.mocked(authMode).mockResolvedValue("dev");
    vi.mocked(api.templates).mockResolvedValue([
      tpl({ id: "t2", complianceApprovalId: "appr_1" }),
    ] as never);
    render(<CommsPanel me={admin} />);

    await userEvent.selectOptions(await screen.findByLabelText("Template"), "t2");
    expect(screen.getByLabelText("Access code")).toBeInTheDocument();
  });

  it("hides the access code on an SMS send in clerk mode (session re-auths)", async () => {
    vi.mocked(authMode).mockResolvedValue("clerk");
    vi.mocked(api.templates).mockResolvedValue([
      tpl({ id: "t2", complianceApprovalId: "appr_1" }),
    ] as never);
    render(<CommsPanel me={admin} />);

    // Wait for authMode() to resolve and apply.
    await screen.findByText(/Send/);
    await userEvent.selectOptions(await screen.findByLabelText("Template"), "t2");
    expect(screen.queryByLabelText("Access code")).not.toBeInTheDocument();
    expect(screen.getByText(/Your session re-authorizes/)).toBeInTheDocument();
  });
});
