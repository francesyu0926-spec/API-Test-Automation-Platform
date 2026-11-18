export type LatencyBin = { lo: number; hi: number; count: number; label: string };

export function latencyBins(durationsMs: number[], bucketMs = 50): LatencyBin[] {
  if (!durationsMs.length) return [];
  const max = Math.max(...durationsMs);
  const bucket = Math.max(10, bucketMs);
  const binCount = Math.min(24, Math.ceil(max / bucket) + 1);
  const counts = Array.from({ length: binCount }, () => 0);
  for (const d of durationsMs) {
    const i = Math.min(binCount - 1, Math.floor(d / bucket));
    counts[i]++;
  }
  return counts.map((count, i) => {
    const lo = i * bucket;
    const hi = lo + bucket;
    return { lo, hi, count, label: `${lo}–${hi}` };
  });
}

/** @deprecated 使用 D3 图表；保留供调试 */
export function latencyHistogram(durationsMs: number[], bucketMs = 50): string[] {
  return latencyBins(durationsMs, bucketMs).map(
    (b) => `${String(b.lo).padStart(4)}-${String(b.hi).padEnd(4)} ms  ${b.count}`,
  );
}