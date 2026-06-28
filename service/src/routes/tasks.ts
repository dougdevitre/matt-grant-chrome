import { Router } from "express";
import type { Response } from "express";
import { requireScope } from "../auth.js";
import {
  buildQueue,
  claimTask,
  completeTask,
  skipTask,
  type TaskActionResult,
} from "../lib/tasks.js";

export const tasksRouter = Router();

const STATUS_FOR: Record<string, number> = {
  not_found: 404,
  forbidden_scope: 403,
  not_assignee: 403,
  phase_closed: 409,
  already_claimed: 409,
  version_conflict: 409,
  bad_status: 409,
};

function send(res: Response, result: TaskActionResult): void {
  if (result.ok) {
    res.json(result.task);
    return;
  }
  res.status(STATUS_FOR[result.code] ?? 400).json({ error: result.code });
}

// GET /tasks?zip= — next-best-action queue for this clerk.
tasksRouter.get("/", requireScope("task.read"), async (req, res) => {
  const clerk = req.clerk!;
  const zip = typeof req.query.zip === "string" ? req.query.zip : null;
  res.json(await buildQueue(clerk.clerkId, clerk.scopes, { zip }));
});

// POST /tasks/:id/claim
tasksRouter.post("/:id/claim", requireScope("task.read"), async (req, res) => {
  const clerk = req.clerk!;
  const expectedVersion =
    typeof req.body?.version === "number" ? req.body.version : undefined;
  send(res, await claimTask(req.params.id, clerk.clerkId, clerk.scopes, expectedVersion));
});

// POST /tasks/:id/complete
tasksRouter.post("/:id/complete", requireScope("task.write"), async (req, res) => {
  const clerk = req.clerk!;
  send(res, await completeTask(req.params.id, clerk.clerkId, clerk.scopes));
});

// POST /tasks/:id/skip  { reason?: string }
tasksRouter.post("/:id/skip", requireScope("task.write"), async (req, res) => {
  const clerk = req.clerk!;
  const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
  send(res, await skipTask(req.params.id, clerk.clerkId, reason));
});
