// Minimal structured (JSON) logger — one line per event so logs are queryable in
// CloudWatch/Datadog instead of free-form console strings. Level via LOG_LEVEL
// (debug|info|warn|error), default info.

type Level = "debug" | "info" | "warn" | "error";
const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  return RANK[(process.env.LOG_LEVEL as Level) ?? "info"] ?? RANK.info;
}

function emit(level: Level, msg: string, fields: Record<string, unknown>): void {
  if (RANK[level] < threshold()) return;
  const line = JSON.stringify({ level, msg, ...fields, ts: new Date().toISOString() });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields: Record<string, unknown> = {}) => emit("debug", msg, fields),
  info: (msg: string, fields: Record<string, unknown> = {}) => emit("info", msg, fields),
  warn: (msg: string, fields: Record<string, unknown> = {}) => emit("warn", msg, fields),
  error: (msg: string, fields: Record<string, unknown> = {}) => emit("error", msg, fields),
};
