import type { HttpBenchmarkReport } from "../../shared/apiWorkbenchTypes";
import type { PercentileApproxMeta } from "../../shared/jtlStreamAggregator";
import { PercentileTh, percentileApproxTooltip } from "./percentileApprox";

export type AggregateReportRow = {
  label: string;
  samples: number;
  average: number;
  median: number;
  line90: number;
  line95: number;
  line99: number;
  min: number | null;
  max: number | null;
  errorPct: number;
  throughputHour: number;
  throughputSec: number;
  receivedKbSec: number;
  sentKbSec: number;
};

const EMPTY_LAT = { min: null, max: null, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 };

export type BenchmarkErrorSummary = { message: string; count: number };

export function summarizeBenchmarkErrors(report: HttpBenchmarkReport): BenchmarkErrorSummary[] {
  const measured = report.samples.filter((s) => !s.warmup);
  const map = new Map<string, number>();
  for (const s of measured) {
    if (s.ok && !s.error) continue;
    const msg =
      s.error?.trim() ||
      (s.status > 0 ? `HTTP ${s.status}（非 2xx）` : "请求失败（无状态码）");
    map.set(msg, (map.get(msg) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([message, count]) => ({ message, count }));
}

export function primaryBenchmarkError(report: HttpBenchmarkReport | null): string | null {
  if (!report) return null;
  const list = summarizeBenchmarkErrors(report);
  return list[0]?.message ?? null;
}

export function buildAggregateRows(report: HttpBenchmarkReport | null): AggregateReportRow[] {
  if (!report || report.stats.samples === 0) {
    return [emptyAggregateRow("TOTAL")];
  }

  const data = rowFromReport(report);
  const label = report.request.name?.trim() || report.request.method || "HTTP 请求";
  return [{ ...data, label }, { ...data, label: "TOTAL" }];
}

function emptyAggregateRow(label: string): AggregateReportRow {
  return {
    label,
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
  };
}

export function rowFromReport(report: HttpBenchmarkReport): AggregateReportRow {
  const s = report.stats;
  const lat = s.latency;
  const wallSec = s.wallMs > 0 ? s.wallMs / 1000 : 0;
  const errorPct = s.samples > 0 ? (s.failed / s.samples) * 100 : 0;
  const throughputSec = wallSec > 0 ? s.success / wallSec : 0;
  const received = s.bytesReceived ?? 0;
  const sent = s.bytesSent ?? 0;
  return {
    label: "TOTAL",
    samples: s.samples,
    average: lat.avg,
    median: lat.p50,
    line90: lat.p90,
    line95: lat.p95,
    line99: lat.p99,
    min: lat.min,
    max: lat.max,
    errorPct,
    throughputHour: throughputSec * 3600,
    throughputSec,
    receivedKbSec: wallSec > 0 ? received / 1024 / wallSec : 0,
    sentKbSec: wallSec > 0 ? sent / 1024 / wallSec : 0,
  };
}

function fmtNum(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "0";
  return digits > 0 ? n.toFixed(digits) : String(Math.round(n));
}

function fmtLatency(n: number | null): string {
  if (n == null) return "—";
  return fmtNum(n);
}

type TableProps = {
  rows: AggregateReportRow[];
  errorTooltip?: string | null;
  /** 表头副标题（请求名或 URL） */
  caption?: string | null;
  /** 顶部已有摘要时隐藏重复标题 */
  compactHead?: boolean;
};

export default function AggregateReportTable({ rows, errorTooltip, caption, compactHead }: TableProps) {
  return (
    <section className="loadtest-aggregate" aria-labelledby="loadtest-aggregate-table-title">
      {compactHead ? (
        <h4 id="loadtest-aggregate-table-title" className="visually-hidden">
          聚合指标表
        </h4>
      ) : (
        <header className="loadtest-aggregate-head">
          <div>
            <h4 id="loadtest-aggregate-table-title" className="loadtest-aggregate-head-title">
              聚合指标表
            </h4>
            {caption ? (
              <p className="loadtest-aggregate-head-caption" title={caption}>
                {caption}
              </p>
            ) : (
              <p className="hint loadtest-aggregate-head-caption">压测结束后按 JMeter Aggregate Report 列展示</p>
            )}
          </div>
        </header>
      )}
      <div className="loadtest-aggregate-table-wrap">
        <table className="loadtest-aggregate-table">
          <thead>
            <tr>
              <th>名称</th>
              <th className="num">样本</th>
              <th className="num">平均</th>
              <th className="num">中位</th>
              <th className="num">P90</th>
              <th className="num">P95</th>
              <th className="num">P99</th>
              <th className="num">最小</th>
              <th className="num">最大</th>
              <th className="num">错误率</th>
              <th className="num">吞吐</th>
              <th className="num">收 KB/s</th>
              <th className="num">发 KB/s</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={row.label === "TOTAL" ? "loadtest-aggregate-total" : ""}>
                <td className="loadtest-aggregate-label">{row.label}</td>
                <td className="num">{row.samples}</td>
                <td className="num">{fmtNum(row.average)}</td>
                <td className="num">{fmtNum(row.median)}</td>
                <td className="num">{fmtNum(row.line90)}</td>
                <td className="num">{fmtNum(row.line95)}</td>
                <td className="num">{fmtNum(row.line99)}</td>
                <td className="num">{fmtLatency(row.min)}</td>
                <td className="num">{fmtLatency(row.max)}</td>
                <td
                  className={`num${row.errorPct > 0 ? " loadtest-aggregate-error-pct" : ""}`}
                  title={row.errorPct > 0 && errorTooltip ? errorTooltip : undefined}
                >
                  {row.errorPct.toFixed(2)}%
                </td>
                <td
                  className="num"
                  title={
                    row.samples === 0 ? undefined : `${fmtNum(row.throughputHour, 2)}/hour · JMeter 风格`
                  }
                >
                  {row.samples === 0 ? "—" : `${fmtNum(row.throughputSec, 2)}/s`}
                </td>
                <td className="num">{fmtNum(row.receivedKbSec, 2)}</td>
                <td className="num">{fmtNum(row.sentKbSec, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}