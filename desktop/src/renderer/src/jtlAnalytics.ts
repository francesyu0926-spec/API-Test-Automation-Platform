import type { HttpBenchmarkReport, HttpBenchmarkSample, WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import type { JtlSample } from "../../shared/jtl";
import { inferHttpMethodFromLabel, pathHintFromLabel } from "../../shared/jtl";
import { buildJmeterStatistics, globalWallMs, type JmeterStatRow } from "../../shared/jmeterStatistics";
import type { AggregateReportRow } from "./aggregateReportTable";
import { defaultDraft } from "./apiWorkbenchModel";

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

function isHttpSample(s: JtlSample): boolean {
  const url = s.url.trim().toLowerCase();
  return url !== "" && url !== "null";
}

export function jtlHttpSamples(samples: JtlSample[]): JtlSample[] {
  return samples.filter(isHttpSample);
}

export type JtlImportSummary = {
  totalRows: number;
  httpSamples: number;
  skippedWs: number;
  labels: number;
  threadPeak: number;
  startedAt: string;
  endedAt: string;
  wallMs: number;
};

export function summarizeJtlFile(samples: JtlSample[]): JtlImportSummary {
  const http = jtlHttpSamples(samples);
  const ts = samples.map((s) => s.timeStamp).filter((t) => t > 0);
  const minTs = ts.length ? Math.min(...ts) : 0;
  const maxTs = ts.length ? Math.max(...ts) : 0;
  const wallMs = globalWallMs(samples);
  const labels = new Set(samples.map((s) => s.label));
  return {
    totalRows: samples.length,
    httpSamples: http.length,
    skippedWs: samples.length - http.length,
    labels: labels.size,
    threadPeak: samples.length
      ? Math.max(1, ...samples.map((s) => s.allThreads || s.grpThreads || 1))
      : 1,
    startedAt: minTs ? new Date(minTs).toISOString() : new Date().toISOString(),
    endedAt: maxTs ? new Date(maxTs).toISOString() : new Date().toISOString(),
    wallMs,
  };
}

export function jmeterStatToAggregateRow(s: JmeterStatRow): AggregateReportRow {
  return {
    label: s.transaction,
    samples: s.sampleCount,
    average: Math.round(s.meanResTime),
    median: Math.round(s.medianResTime),
    line90: Math.round(s.pct1ResTime),
    line95: Math.round(s.pct2ResTime),
    line99: Math.round(s.pct3ResTime),
    min: s.sampleCount ? s.minResTime : null,
    max: s.sampleCount ? s.maxResTime : null,
    errorPct: s.errorPct,
    throughputSec: s.throughput,
    throughputHour: s.throughput * 3600,
    receivedKbSec: s.receivedKBytesPerSec,
    sentKbSec: s.sentKBytesPerSec,
  };
}

/** 与 JMeter report/statistics.json + Dashboard Statistics 表一致（含 WS、Total） */
export function buildJtlAggregateRows(samples: JtlSample[]): AggregateReportRow[] {
  if (!samples.length) return [];
  return buildJmeterStatistics(samples).map(jmeterStatToAggregateRow);
}

export { buildJmeterStatistics, globalWallMs };

export type JtlEndpointDraft = { label: string; draft: WorkbenchDraft };

export function uniqueJtlEndpoints(samples: JtlSample[]): JtlEndpointDraft[] {
  const http = jtlHttpSamples(samples);
  const seen = new Set<string>();
  const out: JtlEndpointDraft[] = [];

  for (const s of http) {
    const method = inferHttpMethodFromLabel(s.label);
    const url = s.url.trim();
    const key = `${method}\t${url}\t${s.label}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const draft: WorkbenchDraft = {
      ...defaultDraft(),
      name: s.label,
      method,
      url,
      headers: [
        { key: "token", value: "{{token}}", enabled: true },
        { key: "secret", value: "{{secret}}", enabled: true },
        { key: "terminalenv", value: "{{terminalenv}}", enabled: true },
      ],
      bodyMode: method === "GET" || method === "HEAD" ? "none" : "raw",
      body: method === "POST" ? "{}" : "",
      bodyContentType: "application/json",
    };

  // Fallback path-only URL when JTL URL is host root
    if (!url || url.endsWith(".com") || url.endsWith(".com/")) {
      const path = pathHintFromLabel(s.label);
      if (path) {
        try {
          const base = url && url !== "null" ? url.replace(/\/$/, "") : "https://terminal.sfccn.com";
          draft.url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
        } catch {
          draft.url = url;
        }
      }
    }

    out.push({ label: s.label, draft });
  }
  return out;
}

function jtlSamplesToBenchmarkSamples(rows: JtlSample[]): HttpBenchmarkSample[] {
  return rows.map((s, i) => ({
    index: i + 1,
    warmup: false,
    ok: s.success,
    status: Number(s.responseCode) || 0,
    durationMs: s.elapsed,
    bodySize: s.bytes,
    error: s.success ? undefined : s.responseMessage || `HTTP ${s.responseCode}`,
  }));
}

/** 每个 JMeter 标签生成一份 HttpBenchmarkReport，供 PDF 合并导出复用 */
export function jtlToBenchmarkReports(samples: JtlSample[], _sourceFile: string): HttpBenchmarkReport[] {
  const http = jtlHttpSamples(samples);
  const summary = summarizeJtlFile(samples);
  const byLabel = new Map<string, JtlSample[]>();
  for (const s of http) {
    const bucket = byLabel.get(s.label) ?? [];
    bucket.push(s);
    byLabel.set(s.label, bucket);
  }

  const reports: HttpBenchmarkReport[] = [];
  let n = 0;
  for (const [label, group] of byLabel.entries()) {
    const method = inferHttpMethodFromLabel(label);
    const url = group.find((g) => g.url && g.url !== "null")?.url ?? label;
    const benchSamples = jtlSamplesToBenchmarkSamples(group);
    const durations = group.map((s) => s.elapsed).sort((a, b) => a - b);
    const failed = group.filter((s) => !s.success).length;
    const success = group.length - failed;
    const statusCodes: Record<string, number> = {};
    for (const s of group) {
      const code = s.responseCode || "0";
      statusCodes[code] = (statusCodes[code] ?? 0) + 1;
    }
    const sum = durations.reduce((a, b) => a + b, 0);
    const ts = group.map((s) => s.timeStamp).filter((t) => t > 0);
    const wallMs = ts.length >= 2 ? Math.max(1, Math.max(...ts) - Math.min(...ts)) : summary.wallMs || 1;
    const wallSec = wallMs / 1000;

    reports.push({
      id: `jtl-${n++}-${label.slice(0, 24).replace(/\W+/g, "_")}`,
      startedAt: summary.startedAt,
      request: { method, url, name: label },
      options: { concurrency: 1, loops: group.length, rampUpSec: 0, warmup: 0 },
      stats: {
        samples: group.length,
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
        bytesReceived: group.reduce((a, r) => a + r.bytes, 0),
        bytesSent: group.reduce((a, r) => a + r.sentBytes, 0),
      },
      samples: benchSamples,
      cancelled: false,
    });
  }
  return reports;
}

const JTL_ARCHIVE_SAMPLE_CAP = 800;

/** 单次 JMX 运行：合并为一条 HttpBenchmarkReport 写入压测历史 */
export function jtlToRunBenchmarkReport(
  samples: JtlSample[],
  meta: { sourceJtl: string; jmxPath?: string },
): HttpBenchmarkReport | null {
  const http = jtlHttpSamples(samples);
  if (!http.length) return null;

  const summary = summarizeJtlFile(samples);
  const statRows = buildJmeterStatistics(samples);
  const total = statRows.find((r) => r.transaction === "Total") ?? statRows[0];
  if (!total?.sampleCount) return null;

  const jmxBase = meta.jmxPath
    ? meta.jmxPath.replace(/^.*[\\/]/, "").replace(/\.jmx$/i, "")
    : meta.sourceJtl.replace(/^.*[\\/]/, "").replace(/\.jtl$/i, "");

  const statusCodes: Record<string, number> = {};
  for (const s of http) {
    const code = s.responseCode || "0";
    statusCodes[code] = (statusCodes[code] ?? 0) + 1;
  }

  const wallMs = summary.wallMs || globalWallMs(samples);
  const wallSec = wallMs / 1000;
  const success = total.sampleCount - total.errorCount;
  const allBench = jtlSamplesToBenchmarkSamples(http);
  const storedSamples =
    allBench.length > JTL_ARCHIVE_SAMPLE_CAP ? allBench.slice(0, JTL_ARCHIVE_SAMPLE_CAP) : allBench;

  const stamp = summary.startedAt.replace(/[:.]/g, "-").slice(0, 19);
  return {
    id: `jmeter-${stamp}-${Math.random().toString(36).slice(2, 9)}`,
    startedAt: summary.startedAt,
    request: {
      method: "JMX",
      url: meta.sourceJtl,
      name: `JMeter · ${jmxBase}`,
    },
    options: {
      concurrency: summary.threadPeak,
      loops: Math.max(1, Math.round(total.sampleCount / Math.max(1, summary.threadPeak))),
      rampUpSec: 0,
      warmup: 0,
    },
    stats: {
      samples: total.sampleCount,
      success,
      failed: total.errorCount,
      wallMs,
      rps: wallSec > 0 ? Math.round((total.throughput + Number.EPSILON) * 100) / 100 : 0,
      latency: {
        min: Math.round(total.minResTime),
        max: Math.round(total.maxResTime),
        avg: Math.round(total.meanResTime),
        p50: Math.round(total.medianResTime),
        p90: Math.round(total.pct1ResTime),
        p95: Math.round(total.pct2ResTime),
        p99: Math.round(total.pct3ResTime),
      },
      statusCodes,
      bytesReceived: http.reduce((a, r) => a + r.bytes, 0),
      bytesSent: http.reduce((a, r) => a + r.sentBytes, 0),
    },
    samples: storedSamples,
    cancelled: false,
  };
}

export function jtlErrorSummary(samples: JtlSample[]): Array<{ message: string; count: number }> {
  const http = jtlHttpSamples(samples);
  const map = new Map<string, number>();
  for (const s of http) {
    if (s.success) continue;
    const msg =
      s.responseMessage?.trim() ||
      (s.responseCode ? `HTTP ${s.responseCode}` : "请求失败");
    map.set(msg, (map.get(msg) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([message, count]) => ({ message, count }));
}