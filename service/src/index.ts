// matt-grant-chrome microservice entrypoint.
// Stateless Express app. Deploy on Lambda+API Gateway, Fargate, or any Node host.

import express from "express";
import cors from "cors";
import { ALLOWED_ORIGIN, PORT, assertSecureStartup } from "./config.js";
import { authenticate } from "./auth.js";
import { authRouter } from "./routes/auth.js";
import { twilioRouter } from "./routes/twilio.js";
import { meRouter } from "./routes/me.js";
import { phaseRouter } from "./routes/phase.js";
import { locationRouter } from "./routes/location.js";
import { tasksRouter } from "./routes/tasks.js";
import { eventsRouter } from "./routes/events.js";
import { commsRouter } from "./routes/comms.js";
import { contactsRouter } from "./routes/contacts.js";
import { securityHeaders } from "./lib/securityHeaders.js";

const app = express();
app.disable("x-powered-by"); // don't advertise Express

app.use(securityHeaders);
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" })); // Twilio webhooks
app.use(
  cors({
    origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN.split(","),
    // Only the verbs the API actually uses.
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization", "Content-Type", "X-StepUp-Token", "X-Twilio-Signature"],
  })
);

// Public health check (no auth).
app.get("/health", (_req, res) => res.json({ ok: true }));

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
app.use("/contacts", contactsRouter);

// Fallthrough error handler — never leak internals.
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  }
);

// Exported so tests (supertest) can import the configured app without binding a
// port. The boot guard + listen below only run when this file is the entrypoint.
export { app };

const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const problems = await assertSecureStartup();
  if (problems.length > 0) {
    console.error("FATAL: insecure configuration, refusing to start:");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`matt-grant-chrome service listening on :${PORT}`);
  });
}
