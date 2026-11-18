import type { HttpBenchmarkReport } from "../../shared/apiWorkbenchTypes";
import type { AggregateReportRow, BenchmarkErrorSummary } from "./aggregateReportTable";
import { formatPerfStartedAtLocal } from "./perfDateTime";
import { mergeReportsStats, mergeStatusCodes } from "./perfReportMerge";

export type PerfReportVisualInput = {
  report: HttpBenchmarkReport;
  aggregateRows: AggregateReportRow[];
  errorSummary: BenchmarkErrorSummary[];
  charts: { latencyPng?: string; statusPng?: string };
  projectId: string;
};

export type MultiPerfReportPdfInput = {
  projectId: string;
  reports: HttpBenchmarkReport[];
  aggregateRows: AggregateReportRow[];
  errorSummary: BenchmarkErrorSummary[];
  charts: { latencyPng?: string; statusPng?: string };
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtLatency(n: number | null): string {
  if (n == null) return "—";
  return String(Math.round(n));
}

const PDF_STYLES = `
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif;
      font-size: 11px;
      color: #1e293b;
      margin: 0;
      padding: 24px 28px;
      line-height: 1.45;
    }
    h1 { font-size: 20px; margin: 0 0 4px; color: #0f172a; }
    .meta { color: #64748b; margin-bottom: 16px; }
    .meta code { font-size: 10px; word-break: break-all; }
    h2 {
      font-size: 13px;
      margin: 0 0 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid #e2e8f0;
      color: #334155;
    }
    .block { margin-bottom: 18px; page-break-inside: avoid; }
    .block--error { background: #fef2f2; border: 1px solid #fecaca; padding: 10px 12px; border-radius: 6px; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 8px;
      margin-bottom: 4px;
    }
    .metric {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 10px;
      background: #f8fafc;
    }
    .metric .k { color: #64748b; font-size: 10px; }
    .metric .v { font-size: 14px; font-weight: 600; margin-top: 2px; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }
    th, td {
      border: 1px solid #e2e8f0;
      padding: 5px 6px;
      text-align: left;
    }
    th { background: #f1f5f9; font-weight: 600; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .charts {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    figure { margin: 0; }
    figcaption { font-size: 10px; color: #64748b; margin-bottom: 4px; }
    .chart-note { font-size: 9px; color: #64748b; margin: 4px 0 0; }
    img { width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 6px; }
    ul { margin: 0; padding-left: 18px; }
    .footnote { color: #94a3b8; font-size: 9px; margin-top: 12px; }
`;

export function buildPerfReportPdfHtml(input: PerfReportVisualInput): string {
  return buildMultiPerfReportPdfHtml({
    projectId: input.projectId,
    reports: [input.report],
    aggregateRows: input.aggregateRows,
    errorSummary: input.errorSummary,
    charts: input.charts,
  });
}

export function buildMultiPerfReportPdfHtml(input: MultiPerfReportPdfInput): string {
  const { reports, aggregateRows, errorSummary, charts, projectId } = input;
  if (!reports.length) return "";

  const multi = reports.length > 1;
  const merged = mergeReportsStats(reports);
  const statusMerged = mergeStatusCodes(reports);
  const primary = reports[0];
  const o = primary.options;
  const req = primary.request;

  const aggregateBody = aggregateRows
    .map(
      (r) => `<tr>
      <td>${esc(r.label)}</td>
      <td class="num">${r.samples}</td>
      <td class="num">${fmtLatency(r.average)}</td>
      <td class="num">${fmtLatency(r.median)}</td>
      <td class="num">${fmtLatency(r.line90)}</td>
      <td class="num">${fmtLatency(r.line95)}</td>
      <td class="num">${fmtLatency(r.line99)}</td>
      <td class="num">${r.errorPct.toFixed(1)}%</td>
      <td class="num">${r.throughputSec.toFixed(2)}</td>
    </tr>`,
    )
    .join("");

  const runListBody = reports
    .map(
      (r) => `<tr>
      <td>${esc(formatPerfStartedAtLocal(r.startedAt))}</td>
      <td><code>${esc(r.request.method)} ${esc(r.request.name || r.request.url)}</code></td>
      <td class="num">${r.stats.samples}</td>
      <td class="num">${r.stats.success}</td>
      <td class="num">${r.stats.failed}</td>
      <td class="num">${r.stats.rps}</td>
      <td class="num">${r.stats.latency.p95}</td>
    </tr>`,
    )
    .join("");

  const samples = multi
    ? []
    : primary.samples.filter((x) => !x.warmup);
  const sampleRows = samples
    .slice(0, 80)
    .map(
      (x, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td>${x.ok ? "成功" : "失败"}</td>
      <td class="num">${x.status || "—"}</td>
      <td class="num">${x.durationMs}</td>
      <td class="num">${x.bodySize ?? 0} B</td>
      <td>${esc(x.error ?? "")}</td>
    </tr>`,
    )
    .join("");

  const errorsBlock =
    errorSummary.length > 0
      ? `<section class="block block--error">
      <h2>错误原因</h2>
      <ul>${errorSummary.map((e) => `<li><strong>${e.count}×</strong> ${esc(e.message)}</li>`).join("")}</ul>
    </section>`
      : "";

  const chartsBlock =
    charts.latencyPng || charts.statusPng
      ? `<section class="block">
      <h2>可视化${multi ? "（合并）" : ""}</h2>
      <div class="charts">
        ${
          charts.latencyPng
            ? `<figure><figcaption>延迟分布 · 桶宽 50ms</figcaption><img src="${charts.latencyPng}" alt="延迟分布" /><p class="chart-note">柱高 = 各时间区间内请求次数</p></figure>`
            : ""
        }
        ${
          charts.statusPng
            ? `<figure><figcaption>状态码</figcaption><img src="${charts.statusPng}" alt="状态码" /><p class="chart-note">${Object.entries(
                statusMerged,
              )
                .map(([code, n]) => `HTTP ${esc(code)}：${n} 次`)
                .join(" · ")}</p></figure>`
            : ""
        }
      </div>
    </section>`
      : "";

  const configBlock = multi
    ? ""
    : `<section class="block">
    <h2>运行配置</h2>
    <p>线程 ${o.concurrency} · 循环 ${o.loops ?? "—"} · Ramp-Up ${o.rampUpSec ?? 0}s · 预热 ${o.warmup ?? 0}</p>
  </section>`;

  const runsBlock = multi
    ? `<section class="block">
    <h2>包含的执行（${reports.length}）</h2>
    <table>
      <thead>
        <tr>
          <th>时间</th><th>接口</th><th>#</th><th>成功</th><th>失败</th><th>TPS</th><th>P95(ms)</th>
        </tr>
      </thead>
      <tbody>${runListBody}</tbody>
    </table>
  </section>`
    : "";

  const samplesBlock = multi
    ? ""
    : `<section class="block">
    <h2>请求样本${samples.length > 80 ? `（前 80 / ${samples.length}）` : ""}</h2>
    <table>
      <thead>
        <tr><th>#</th><th>结果</th><th>状态码</th><th>耗时(ms)</th><th>大小</th><th>说明</th></tr>
      </thead>
      <tbody>${sampleRows || '<tr><td colspan="6">无样本</td></tr>'}</tbody>
    </table>
  </section>`;

  const title = multi ? "合并压测报告" : "负载测试报告";
  const meta = multi
    ? `项目 <strong>${esc(projectId)}</strong> · ${reports.length} 次执行 · 生成于 ${esc(new Date().toISOString().slice(0, 19))}`
    : `项目 <strong>${esc(projectId)}</strong> · ${esc(primary.startedAt)} · ID ${esc(primary.id)}<br />
    <code>${esc(req.method)} ${esc(req.url)}</code>`;

  const s = multi ? merged : primary.stats;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>${PDF_STYLES}</style>
</head>
<body>
  <h1>${title}</h1>
  <p class="meta">${meta}</p>

  ${runsBlock}
  ${configBlock}

  <section class="block">
    <h2>汇总指标${multi ? "（合并）" : ""}</h2>
    <div class="metrics">
      <div class="metric"><div class="k">样本</div><div class="v">${s.samples}</div></div>
      <div class="metric"><div class="k">成功</div><div class="v">${s.success}</div></div>
      <div class="metric"><div class="k">失败</div><div class="v">${s.failed}</div></div>
      <div class="metric"><div class="k">吞吐</div><div class="v">${s.rps} req/s</div></div>
      <div class="metric"><div class="k">耗时</div><div class="v">${s.wallMs} ms</div></div>
      <div class="metric"><div class="k">p50</div><div class="v">${s.latency.p50} ms</div></div>
      <div class="metric"><div class="k">p95</div><div class="v">${s.latency.p95} ms</div></div>
      <div class="metric"><div class="k">p99</div><div class="v">${s.latency.p99} ms</div></div>
      <div class="metric"><div class="k">avg</div><div class="v">${s.latency.avg} ms</div></div>
      <div class="metric"><div class="k">min–max</div><div class="v">${s.latency.min}–${s.latency.max} ms</div></div>
    </div>
  </section>

  <section class="block">
    <h2>聚合报告</h2>
    <table>
      <thead>
        <tr>
          <th>Label</th><th>#</th><th>Avg</th><th>Med</th><th>90%</th><th>95%</th><th>99%</th><th>Err%</th><th>TPS</th>
        </tr>
      </thead>
      <tbody>${aggregateBody}</tbody>
    </table>
  </section>

  ${errorsBlock}
  ${chartsBlock}
  ${samplesBlock}

  <p class="footnote">由 API Test Platform 自动生成 · ${esc(new Date().toISOString())}</p>
</body>
</html>`;
}