import { randomBytes } from "node:crypto";

import type {
  HttpBenchmarkOptions,
  HttpBenchmarkReport,
  HttpBenchmarkSample,
  HttpBenchmarkStats,
  HttpSendPayload,
} from "../shared/apiWorkbenchTypes";
import { sendHttpRequest } from "./httpRequest";

let cancelRequested = false;

export function cancelHttpBenchmark(): void {
  cancelRequested = true;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

function buildStats(samples: HttpBenchmarkSample[], wallMs: number): HttpBenchmarkStats {
  const measured = samples.filter((s) => !s.warmup);
  const success = measured.filter((s) => s.ok && !s.error).length;
  const failed = measured.length - success;
  const durations = measured.map((s) => s.durationMs).sort((a, b) => a - b);
  const statusCodes: Record<string, number> = {};
  for (const s of measured) {
    const key = s.status ? String(s.status) : s.error ? "error" : "0";
    statusCodes[key] = (statusCodes[key] ?? 0) + 1;
  }
  const sum = durations.reduce((a, b) => a + b, 0);
  const wallSec = wallMs / 1000;
  return {
    samples: measured.length,
    success,
    failed,
    wallMs,
    rps: wallSec > 0 ? Math.round((success / wallSec) * 100) / 100 : 0,
    latency: {
      min: durations[0] ?? 0,
      max: durations[durations.length - 1] ?? 0,
      avg: durations.length ? Math.round(sum / durations.length) : 0,
      p50: percentile(durations, 0.5),
      p90: percentile(durations, 0.9),
      p95: percentile(durations, 0.95),
      p99: percentile(durations, 0.99),
    },
    statusCodes,
  };
}

const MAX_TOTAL = 500;
const MAX_CONCURRENCY = 50;

export async function runHttpBenchmark(
  payload: HttpSendPayload,
  options: HttpBenchmarkOptions,
  meta?: { name?: string },
): Promise<HttpBenchmarkReport> {
  cancelRequested = false;
  const total = Math.min(Math.max(1, Math.floor(options.total)), MAX_TOTAL);
  const concurrency = Math.min(Math.max(1, Math.floor(options.concurrency)), MAX_CONCURRENCY);
  const warmup = Math.min(Math.max(0, Math.floor(options.warmup ?? 0)), total - 1);
  const timeoutMs = options.timeoutMs ?? payload.timeoutMs ?? 60_000;

  const startedAt = new Date().toISOString();
  const reportId = randomBytes(8).toString("hex");
  const samples: HttpBenchmarkSample[] = [];
  const wallStart = performance.now();

  let nextIndex = 0;

  const runOne = async (index: number): Promise<void> => {
    if (cancelRequested) return;
    const res = await sendHttpRequest({ ...payload, timeoutMs, lite: true });
    samples.push({
      index,
      warmup: index < warmup,
      durationMs: res.durationMs,
      status: res.status,
      ok: res.ok,
      error: res.error,
      bodySize: res.bodySize,
    });
  };

  const worker = async (): Promise<void> => {
    while (!cancelRequested) {
      const index = nextIndex++;
      if (index >= total) break;
      await runOne(index);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  samples.sort((a, b) => a.index - b.index);
  const wallMs = Math.round(performance.now() - wallStart);

  return {
    id: reportId,
    startedAt,
    request: { method: payload.method, url: payload.url, name: meta?.name },
    options: { total, concurrency, warmup, timeoutMs },
    stats: buildStats(samples, wallMs),
    samples,
    cancelled: cancelRequested,
  };
}