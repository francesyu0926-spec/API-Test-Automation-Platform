import type { HttpBenchmarkReport, HttpBenchmarkStats } from "../../shared/apiWorkbenchTypes";

import {
  type AggregateReportRow,
  type BenchmarkErrorSummary,
  rowFromReport,
  summarizeBenchmarkErrors,
} from "./aggregateReportTable";

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

export function endpointKey(report: HttpBenchmarkReport): string {
  const name = report.request.name?.trim();
  if (name) return `${report.request.method} ${name}`;
  return `${report.request.method} ${report.request.url}`;
}

export function reportRowLabel(report: HttpBenchmarkReport): string {
  const base = report.request.name?.trim() || report.request.url;
  const t = report.startedAt.replace("T", " ").slice(0, 19);
  return `${base} · ${t}`;
}

export function collectMeasuredDurations(reports: HttpBenchmarkReport[]): number[] {
  return reports.flatMap((r) => r.samples.filter((s) => !s.warmup).map((s) => s.durationMs));
}

export function mergeStatusCodes(reports: HttpBenchmarkReport[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reports) {
    for (const [code, n] of Object.entries(r.stats.statusCodes)) {
      out[code] = (out[code] ?? 0) + n;
    }
  }
  return out;
}

export function mergeReportsStats(reports: HttpBenchmarkReport[]): HttpBenchmarkStats {
  const measured = reports.flatMap((r) => r.samples.filter((s) => !s.warmup));
  const success = measured.filter((s) => s.ok && !s.error).length;
  const failed = measured.length - success;
  const durations = measured.map((s) => s.durationMs).sort((a, b) => a - b);
  const wallMs = reports.reduce((a, r) => a + r.stats.wallMs, 0);
  const bytesReceived = reports.reduce((a, r) => a + (r.stats.bytesReceived ?? 0), 0);
  const bytesSent = reports.reduce((a, r) => a + (r.stats.bytesSent ?? 0), 0);
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
    statusCodes: mergeStatusCodes(reports),
    bytesReceived,
    bytesSent,
  };
}

export function buildAggregateRowsMulti(reports: HttpBenchmarkReport[]): AggregateReportRow[] {
  if (!reports.length) {
    return [
      {
        label: "TOTAL",
        samples: 0,
        average: 0,
        median: 0,
        line90: 0,
        line95: 0,
        line99: 0,
        min: null,
        max: null,
        errorPct: 0,
        throughputHour: 0,
        throughputSec: 0,
        receivedKbSec: 0,
        sentKbSec: 0,
      },
    ];
  }
  const rows = reports.map((r) => ({ ...rowFromReport(r), label: reportRowLabel(r) }));
  const merged = rowFromReport({
    ...reports[0],
    stats: mergeReportsStats(reports),
    samples: reports.flatMap((r) => r.samples),
  });
  return [...rows, { ...merged, label: "TOTAL" }];
}

export function mergeErrorSummaries(reports: HttpBenchmarkReport[]): BenchmarkErrorSummary[] {
  const map = new Map<string, number>();
  for (const r of reports) {
    for (const e of summarizeBenchmarkErrors(r)) {
      const key = `${reportRowLabel(r)}：${e.message}`;
      map.set(key, (map.get(key) ?? 0) + e.count);
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([message, count]) => ({ message, count }));
}

export function uniqueEndpoints(reports: HttpBenchmarkReport[]): string[] {
  return [...new Set(reports.map(endpointKey))];
}