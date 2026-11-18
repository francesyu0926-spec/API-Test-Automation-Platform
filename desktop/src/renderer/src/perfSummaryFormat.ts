import type { HttpBenchmarkReport } from "../../shared/apiWorkbenchTypes";
import { summarizeBenchmarkErrors } from "./aggregateReportTable";

export function formatPerfSummary(report: HttpBenchmarkReport): string {
  const s = report.stats;
  const o = report.options;
  const errors = summarizeBenchmarkErrors(report);
  const source =
    report.provenance?.sourceJtl?.trim() ||
    report.provenance?.jmxPath?.trim() ||
    report.request.url;
  return [
    `源：${source}`,
    `线程 ${o.concurrency}，循环 ${o.loops ?? "—"}，Ramp-Up ${o.rampUpSec ?? 0}s`,
    `样本 ${s.samples}，成功 ${s.success}，失败 ${s.failed}，墙钟 ${s.wallMs} ms，吞吐 ${s.rps} req/s`,
    `延迟 ms — min ${s.latency.min}，avg ${s.latency.avg}，p50 ${s.latency.p50}，p90 ${s.latency.p90}，p95 ${s.latency.p95}，p99 ${s.latency.p99}，max ${s.latency.max}`,
    `状态码：${formatStatusCodesPlain(s.statusCodes)}`,
    errors.length ? `错误：\n${errors.map((e) => `  ${e.count}× ${e.message}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatStatusCodesPlain(codes: Record<string, number>): string {
  return Object.entries(codes)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([code, n]) => `${code}: ${n}`)
    .join("，");
}

export function perfSummarySourcePath(report: HttpBenchmarkReport): string {
  return (
    report.provenance?.sourceJtl?.trim() ||
    report.provenance?.jmxPath?.trim() ||
    report.request.url?.trim() ||
    "—"
  );
}