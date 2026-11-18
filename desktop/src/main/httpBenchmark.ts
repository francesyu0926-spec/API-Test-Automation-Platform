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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runHttpBenchmark(
  payload: HttpSendPayload,
  options: HttpBenchmarkOptions,
  meta?: { name?: string },
): Promise<HttpBenchmarkReport> {
  cancelRequested = false;
  const concurrency = Math.min(Math.max(1, Math.floor(options.concurrency)), MAX_CONCURRENCY);
  const loopsInput = options.loops != null ? Math.max(1, Math.floor(options.loops)) : null;
  let total: number;
  let effectiveLoops: number | null = null;
  if (loopsInput != null) {
    total = Math.min(concurrency * loopsInput, MAX_TOTAL);
    effectiveLoops = Math.max(1, Math.ceil(total / concurrency));
  } else {
    total = Math.min(Math.max(1, Math.floor(options.total ?? concurrency)), MAX_TOTAL);
  }
  const warmup = Math.min(Math.max(0, Math.floor(options.warmup ?? 0)), Math.max(0, total - 1));
  const timeoutMs = options.timeoutMs ?? payload.timeoutMs ?? 60_000;
  const rampUpSec = Math.max(0, options.rampUpSec ?? 0);

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

  const worker = async (workerId: number): Promise<void> => {
    if (rampUpSec > 0 && concurrency > 1) {
      const delayMs = (rampUpSec * 1000 * workerId) / concurrency;
      if (delayMs > 0) await sleep(delayMs);
    }
    if (effectiveLoops != null) {
      for (let loop = 0; loop < effectiveLoops; loop++) {
        if (cancelRequested) break;
        const index = workerId * effectiveLoops + loop;
        if (index >= total) break;
        await runOne(index);
      }
      return;
    }
    while (!cancelRequested) {
      const index = nextIndex++;
      if (index >= total) break;
      await runOne(index);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, (_, workerId) => worker(workerId)));

  samples.sort((a, b) => a.index - b.index);
  const wallMs = Math.round(performance.now() - wallStart);

  const normalizedOptions: HttpBenchmarkOptions = {
    total,
    concurrency,
    loops: effectiveLoops ?? undefined,
    rampUpSec: rampUpSec > 0 ? rampUpSec : undefined,
    warmup,
    timeoutMs,
  };

  return {
    id: reportId,
    startedAt,
    request: { method: payload.method, url: payload.url, name: meta?.name },
    options: normalizedOptions,
    stats: buildStats(samples, wallMs),
    samples,
    cancelled: cancelRequested,
  };
}