import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskQueue } from "./TaskQueue.js";
import { api } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  api: {
    tasks: vi.fn(),
    claimTask: vi.fn(),
    completeTask: vi.fn(),
    skipTask: vi.fn(),
  },
}));

const me = { clerkId: "c1", role: "registration_clerk", scopes: ["task.read", "task.write"] } as never;

function task(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    kind: "call",
    title: "Call backs",
    detail: "ring the supporters",
    requiresScope: "contact.log",
    phases: ["PHASE_1_REGISTER"],
    priority: 50,
    dueAt: null,
    zip: null,
    status: "open",
    assignedClerkId: null,
    skipReason: null,
    version: 1,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("TaskQueue", () => {
  it("renders an open task and claims it with its version", async () => {
    vi.mocked(api.tasks).mockResolvedValue([task()] as never);
    vi.mocked(api.claimTask).mockResolvedValue(task({ status: "claimed" }) as never);
    render(<TaskQueue me={me} zip={null} />);

    await screen.findByText("Call backs");
    await userEvent.click(screen.getByRole("button", { name: "Claim" }));
    expect(api.claimTask).toHaveBeenCalledWith("t1", 1);
  });

  it("offers Done/Skip on a task assigned to me and completes it", async () => {
    vi.mocked(api.tasks).mockResolvedValue([
      task({ status: "claimed", assignedClerkId: "c1" }),
    ] as never);
    vi.mocked(api.completeTask).mockResolvedValue(task() as never);
    render(<TaskQueue me={me} zip={null} />);

    await screen.findByText("Call backs");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(api.completeTask).toHaveBeenCalledWith("t1");
  });

  it("shows the empty state when the queue is clear", async () => {
    vi.mocked(api.tasks).mockResolvedValue([] as never);
    render(<TaskQueue me={me} zip={null} />);
    expect(await screen.findByText(/queue is clear/i)).toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    vi.mocked(api.tasks).mockRejectedValue(new Error("boom"));
    render(<TaskQueue me={me} zip={null} />);
    expect(await screen.findByText(/Couldn't load tasks: boom/)).toBeInTheDocument();
  });
});
