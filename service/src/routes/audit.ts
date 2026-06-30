import { Router } from "express";
import { requireScope } from "../auth.js";
import { getStore } from "../lib/store.js";
import { verifyAuditChain } from "../lib/auditChain.js";

// Audit log access for compliance/admin (audit.read). /verify recomputes the
// hash chain so tampering with the store is detectable in-app.
export const auditRouter = Router();

// GET /audit/verify — recompute the chain; { ok, length, brokeAt }.
auditRouter.get("/verify", requireScope("audit.read"), async (_req, res) => {
  const store = await getStore();
  const events = await store.readAudit();
  const result = verifyAuditChain(events);
  res.json({ ok: result.ok, length: events.length, brokeAt: result.brokeAt });
});

// GET /audit — list the audit log in chain order.
auditRouter.get("/", requireScope("audit.read"), async (_req, res) => {
  const store = await getStore();
  res.json(await store.readAudit());
});
