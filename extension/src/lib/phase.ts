// Display-only countdown helper. The server decides the actual phase; this only
// formats the remaining time for the banner.

export function timeRemaining(deadlineIso: string, now: Date = new Date()): string {
  const ms = Date.parse(deadlineIso) - now.getTime();
  if (Number.isNaN(ms)) return "";
  if (ms <= 0) return "now";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days >= 1) return `${days}d ${hours}h`;
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}
