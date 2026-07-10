// matt-grant-chrome microservice entrypoint.
// Stateless Express app. Deploy on Lambda+API Gateway, Fargate, or any Node host.

import "express-async-errors"; // forward async route rejections to the error handler
import express from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ALLOWED_ORIGIN, IS_PRODUCTION_LIKE, PORT, assertSecureStartup } from "./config.js";
import { authenticate } from "./auth.js";
import { authRouter } from "./routes/auth.js";
import { twilioRouter } from "./routes/twilio.js";
import { meRouter } from "./routes/me.js";
import { phaseRouter } from "./routes/phase.js";
import { locationRouter } from "./routes/location.js";
import { tasksRouter } from "./routes/tasks.js";
import { eventsRouter } from "./routes/events.js";
import { commsRouter } from "./routes/comms.js";
import { socialRouter } from "./routes/social.js";
import { contactsRouter } from "./routes/contacts.js";
import { followupsRouter } from "./routes/followups.js";
import { teamRouter } from "./routes/team.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { auditRouter } from "./routes/audit.js";
import { securityHeaders } from "./lib/securityHeaders.js";
import { requestId } from "./lib/requestId.js";
import { getStore } from "./lib/store.js";
import { log } from "./lib/logger.js";

const app = express();
app.disable("x-powered-by"); // don't advertise Express

// Trust proxy is OFF by default (req.ip = socket address, X-Forwarded-For
// ignored). Behind an ALB/API Gateway set TRUST_PROXY to the hop count or a
// subnet so req.ip reflects the real client for rate limiting.
const tp = process.env.TRUST_PROXY;
app.set(
  "trust proxy",
  tp === undefined || tp === "" ? false : /^\d+$/.test(tp) ? Number(tp) : tp === "true" ? true : tp
);

app.use(requestId);
app.use(securityHeaders);
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" })); // Twilio webhooks
app.use(
  cors({
    origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN.split(","),
    // Only the verbs the API actually uses (DELETE = team roster soft-remove).
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type", "X-StepUp-Token", "X-Twilio-Signature"],
    // Let paginating clients read the total separately from the (sliced) body.
    exposedHeaders: ["X-Total-Count"],
  })
);

// Public distribution site (no auth): a landing page at `/` with a Download
// button + install/usage instructions, and the packaged extension zip under
// `/download/`. Served from `service/public/` (the zip is produced at build
// time by scripts/pack-extension.mjs). Mounted before `authenticate` so it's
// reachable without a token; it can't clash with the API, which lives under
// named prefixes (/auth, /me, /tasks, …).
const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
app.use(express.static(publicDir, { index: "index.html", maxAge: "1h" }));

// Liveness (no auth): the process is up.
app.get("/health", (_req, res) => res.json({ ok: true }));

// Readiness (no auth): the configured store can be constructed. Kept light — it
// doesn't deep-probe the provider on every poll; a failed construct returns 503.
app.get("/ready", async (_req, res) => {
  try {
    await getStore();
    res.json({ ready: true });
  } catch {
    res.status(503).json({ ready: false });
  }
});

// Public: token exchange (Clerk/dev -> scoped JWT).
app.use("/auth", authRouter);

// Public (signature-validated): Twilio inbound STOP webhook.
app.use("/twilio", twilioRouter);

// Everything below requires a valid clerk JWT.
app.use(authenticate);
app.use("/me", meRouter);
app.use("/phase", phaseRouter);
app.use("/location", locationRouter);
app.use("/tasks", tasksRouter);
app.use("/events", eventsRouter);
app.use("/comms", commsRouter);
app.use("/social", socialRouter);
app.use("/contacts", contactsRouter);
app.use("/followups", followupsRouter);
app.use("/team", teamRouter);
app.use("/dashboard", dashboardRouter);
app.use("/audit", auditRouter);

// Fallthrough error handler — log structured (with the request id) but never
// leak internals to the client.
app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    log.error("unhandled_error", {
      requestId: req.id,
      method: req.method,
      path: req.path,
      err: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: "internal_error" });
  }
);

// Exported so tests (supertest) can import the configured app without binding a
// port. The boot guard + listen below only run when this file is the entrypoint.
export { app };

// Run the production boot guard at module load so it also covers serverless
// deployments that import `app` rather than executing this file directly
// (assertSecureStartup is a no-op outside production, so tests are unaffected).
const problems = await assertSecureStartup();
if (problems.length > 0) {
  log.error("insecure_configuration_refusing_to_start", { problems });
  if (IS_PRODUCTION_LIKE) process.exit(1);
}

const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const server = app.listen(PORT, () => {
    log.info("listening", { port: PORT });
  });

  // Graceful shutdown: stop accepting new connections, let in-flight requests
  // finish, then exit. A hard timeout guards against a hung connection.
  const shutdown = (signal: string) => {
    log.info("shutting_down", { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
