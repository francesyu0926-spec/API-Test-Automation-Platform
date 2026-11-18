import type {
  JmeterApdexRow,
  JmeterErrorRow,
  JmeterSamplerErrorRow,
  JmeterStatRow,
  JmeterTestInfo,
} from "../../shared/jmeterStatistics";
import { formatApdexThresholdMs } from "../../shared/jmeterStatistics";

export type JmeterDashboardPdfInput = {
  testInfo: JmeterTestInfo;
  apdex: JmeterApdexRow[];
  statistics: JmeterStatRow[];
  errors: JmeterErrorRow[];
  top5BySampler: JmeterSamplerErrorRow[];
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n: number, d = 2): string {
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(d);
}

const STYLES = `
  body { font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif; font-size: 10px; color: #1e293b; margin: 0; padding: 20px 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; color: #111827; }
  h2 { font-size: 12px; margin: 16px 0 6px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; color: #334155; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 5px; text-align: left; }
  th { background: #f1f5f9; font-weight: 600; }
  td.num, th.num { text-align: right; }
  tr.total td { font-weight: 600; background: #f8fafc; }
  .infos td:first-child { width: 28%; background: #f8fafc; font-weight: 600; }
  .summary-bar { display: flex; height: 22px; border-radius: 4px; overflow: hidden; margin: 8px 0 4px; border: 1px solid #cbd5e1; }
  .summary-ok { background: #9ca3af; }
  .summary-ko { background: #a67c45; }
  .summary-legend { font-size: 9px; color: #64748b; }
`;

export function buildJmeterDashboardPdfHtml(input: JmeterDashboardPdfInput): string {
  const { testInfo, apdex, statistics, errors, top5BySampler } = input;
  const total = statistics.find((r) => r.transaction === "Total");
  const ok = total ? total.sampleCount - total.errorCount : 0;
  const ko = total?.errorCount ?? 0;
  const okPct = total && total.sampleCount ? (ok / total.sampleCount) * 100 : 0;
  const koPct = total && total.sampleCount ? (ko / total.sampleCount) * 100 : 0;

  const statRows = statistics
    .map((r) => {
      const cls = r.transaction === "Total" ? ' class="total"' : "";
      return `<tr${cls}>
        <td>${esc(r.transaction)}</td>
        <td class="num">${r.sampleCount}</td>
        <td class="num">${r.errorCount}</td>
        <td class="num">${fmt(r.errorPct)}</td>
        <td class="num">${fmt(r.meanResTime, 0)}</td>
        <td class="num">${fmt(r.minResTime, 0)}</td>
        <td class="num">${fmt(r.maxResTime, 0)}</td>
        <td class="num">${fmt(r.medianResTime, 0)}</td>
        <td class="num">${fmt(r.pct1ResTime, 0)}</td>
        <td class="num">${fmt(r.pct2ResTime, 0)}</td>
        <td class="num">${fmt(r.pct3ResTime, 0)}</td>
        <td class="num">${fmt(r.throughput)}</td>
        <td class="num">${fmt(r.receivedKBytesPerSec)}</td>
        <td class="num">${fmt(r.sentKBytesPerSec)}</td>
      </tr>`;
    })
    .join("");

  const apdexRows = apdex
    .map((row) => {
      const cls = row.label === "Total" ? ' class="total"' : "";
      return `<tr${cls}>
        <td class="num">${fmt(row.apdex, 3)}</td>
        <td class="num">${esc(formatApdexThresholdMs(row.satisfiedMs))}</td>
        <td class="num">${esc(formatApdexThresholdMs(row.toleratedMs))}</td>
        <td>${esc(row.label)}</td>
      </tr>`;
    })
    .join("");

  const errorRows =
    errors.length > 0
      ? errors
          .map(
            (e) => `<tr><td>${esc(e.message)}</td><td class="num">${e.count}</td><td class="num">${fmt(e.pct)}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="3">无错误记录</td></tr>';

  const top5Rows =
    top5BySampler.length > 0
      ? top5BySampler
          .map(
            (e) =>
              `<tr><td>${esc(e.sampler)}</td><td>${esc(e.message)}</td><td class="num">${e.count}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="3">无</td></tr>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><title>Apache JMeter Dashboard</title><style>${STYLES}</style></head>
<body>
  <h1>Apache JMeter Dashboard</h1>

  <h2>Test and Report information</h2>
  <table class="infos">
    <tr><td>Source file</td><td>${esc(testInfo.sourceFile)}</td></tr>
    <tr><td>Start Time</td><td>${esc(testInfo.startTime)}</td></tr>
    <tr><td>End Time</td><td>${esc(testInfo.endTime)}</td></tr>
    <tr><td>Duration</td><td>${testInfo.durationMs} ms</td></tr>
  </table>

  <h2>APDEX (Application Performance Index)</h2>
  <table>
    <thead>
      <tr>
        <th class="num">Apdex</th>
        <th class="num">T (Toleration threshold)</th>
        <th class="num">F (Frustration threshold)</th>
        <th>Label</th>
      </tr>
    </thead>
    <tbody>${apdexRows}</tbody>
  </table>

  <h2>Requests Summary</h2>
  <div class="summary-bar">
    <div class="summary-ok" style="width:${okPct}%"></div>
    <div class="summary-ko" style="width:${koPct}%"></div>
  </div>
  <p class="summary-legend">OK ${ok} · KO ${ko} · 共 ${total?.sampleCount ?? 0} 请求</p>

  <h2>Statistics</h2>
  <table>
    <thead>
      <tr>
        <th>Transactions</th>
        <th class="num">#Samples</th>
        <th class="num">FAIL</th>
        <th class="num">Error %</th>
        <th class="num">Average</th>
        <th class="num">Min</th>
        <th class="num">Max</th>
        <th class="num">Median</th>
        <th class="num">90th pct</th>
        <th class="num">95th pct</th>
        <th class="num">99th pct</th>
        <th class="num">Throughput</th>
        <th class="num">Received KB/sec</th>
        <th class="num">Sent KB/sec</th>
      </tr>
    </thead>
    <tbody>${statRows}</tbody>
  </table>

  <h2>Errors</h2>
  <table>
    <thead><tr><th>Type of error</th><th class="num">Number of errors</th><th class="num">% in errors</th></tr></thead>
    <tbody>${errorRows}</tbody>
  </table>

  <h2>Top 5 Errors by sampler</h2>
  <table>
    <thead><tr><th>Sampler</th><th>Sample</th><th class="num">#Samples</th></tr></thead>
    <tbody>${top5Rows}</tbody>
  </table>
</body>
</html>`;
}