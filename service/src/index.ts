// matt-grant-chrome microservice entrypoint.
// Stateless Express app. Deploy on Lambda+API Gateway, Fargate, or any Node host.

// Load .env first so process.env is populated before config.ts reads it. dotenv
// does not override real environment variables, so deployed env/SSM still wins.
import "dotenv/config";
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

const app = express();

app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" })); // Twilio webhooks
app.use(
  cors({
    origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN.split(","),
    methods: ["GET", "POST", "PATCH"],
    allowedHeaders: ["Authorization", "Content-Type"],
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

const problems = await assertSecureStartup();
if (problems.length > 0) {
  console.error("FATAL: insecure configuration, refusing to start:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`matt-grant-chrome service listening on :${PORT}`);
});
