import type { HttpBenchmarkReport } from "../../shared/apiWorkbenchTypes";
import { buildJmeterTestInfoFromRange } from "../../shared/jmeterStatistics";
import { loadPersistedJtlStreamMode } from "./jtlStreamModePrefs";
import { resolveJtlModeForFileSize } from "../../shared/jtlStreamModes";
import {
  buildAggregateRows,
  summarizeBenchmarkErrors,
  type AggregateReportRow,
  type BenchmarkErrorSummary,
} from "./aggregateReportTable";
import { buildJmeterDashboardPdfHtml } from "./jmeterDashboardPdf";
import { latencyBins } from "./perfHistogram";
import { buildPerfReportPdfHtml, type PerfReportVisualInput } from "./perfReportPdfHtml";

async function tryJmeterDashboardHtmlFromJtl(
  jtlPath: string,
  environment?: string,
): Promise<string | null> {
  const p = jtlPath.trim();
  if (!p) return null;
  let agg;
  try {
    const size = await window.atp.statAbsoluteFile(p);
    const preferred = loadPersistedJtlStreamMode();
    const { mode } = resolveJtlModeForFileSize(size, preferred);
    agg = await window.atp.aggregateJtlFile(p, mode);
  } catch {
    return null;
  }
  if (!agg.totalRows) return null;
  const sourceName = p.replace(/^.*[\\/]/, "") || "results.jtl";
  const startMs = new Date(agg.startedAt).getTime();
  const endMs = new Date(agg.endedAt).getTime();
  const durations = agg.samples.map((s) => s.elapsed);
  const latencyBinsForPdf = durations.length
    ? latencyBins(durations, 50).map((b) => ({ label: b.label, count: b.count }))
  : undefined;

  return buildJmeterDashboardPdfHtml({
    testInfo: buildJmeterTestInfoFromRange(startMs, endMs, sourceName),
    apdex: agg.apdex,
    statistics: agg.statistics,
    errors: agg.errorsSummary,
    top5BySampler: agg.top5BySampler,
    environment: environment?.trim() || undefined,
    latencyBins: latencyBinsForPdf,
  });
}

function resolveJtlPath(report: HttpBenchmarkReport): string {
  const fromProv = report.provenance?.sourceJtl?.trim();
  if (fromProv) return fromProv;
  const url = report.request.url?.trim() ?? "";
  if (url.toLowerCase().endsWith(".jtl")) return url;
  return "";
}

/** 与 JTL 报告页「导出 Dashboard PDF」同版式；有 JTL 源文件时优先使用。 */
export async function buildHtmlForPerfReportPdf(
  report: HttpBenchmarkReport,
  projectId: string,
  options?: {
    charts?: PerfReportVisualInput["charts"];
    aggregateRows?: AggregateReportRow[];
    errorSummary?: BenchmarkErrorSummary[];
    /** 与 JTL 页当前环境一致，用于 PDF 顶栏「测试环境」 */
    environment?: string;
  },
): Promise<string> {
  const jtl = resolveJtlPath(report);
  if (jtl) {
    const dash = await tryJmeterDashboardHtmlFromJtl(jtl, options?.environment);
    if (dash) return dash;
  }

  return buildPerfReportPdfHtml({
    report,
    aggregateRows: options?.aggregateRows ?? buildAggregateRows(report),
    errorSummary: options?.errorSummary ?? summarizeBenchmarkErrors(report),
    charts: options?.charts ?? {},
    projectId,
  });
}