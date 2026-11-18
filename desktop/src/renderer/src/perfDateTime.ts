function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Display perf report `startedAt` (ISO UTC or local) in the user's local timezone. */
export function formatPerfStartedAtLocal(iso: string): string {
  const trimmed = iso.trim();
  if (!trimmed) return "—";
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) {
    return trimmed.replace("T", " ").replace(/Z$/i, "").slice(0, 19);
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function perfStartedAtInstant(iso: string): number {
  const t = new Date(iso.trim()).getTime();
  return Number.isNaN(t) ? 0 : t;
}