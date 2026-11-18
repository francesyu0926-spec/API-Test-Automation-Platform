/** 简单延迟直方图，用于压测结果展示 */
export function latencyHistogram(durationsMs: number[], bucketMs = 50): string[] {
  if (!durationsMs.length) return [];
  const max = Math.max(...durationsMs);
  const bucket = Math.max(10, bucketMs);
  const bins = Math.min(24, Math.ceil(max / bucket) + 1);
  const counts = Array.from({ length: bins }, () => 0);
  for (const d of durationsMs) {
    const i = Math.min(bins - 1, Math.floor(d / bucket));
    counts[i]++;
  }
  const peak = Math.max(...counts, 1);
  const lines: string[] = [];
  for (let i = 0; i < bins; i++) {
    const lo = i * bucket;
    const hi = lo + bucket;
    const barLen = Math.round((counts[i] / peak) * 20);
    const bar = "█".repeat(barLen) || "▏";
    lines.push(`${String(lo).padStart(4)}-${String(hi).padEnd(4)} ms  ${bar} ${counts[i]}`);
  }
  return lines;
}