import type {
  JmeterApdexRow,
  JmeterErrorRow,
  JmeterSamplerErrorRow,
  JmeterStatRow,
  JmeterTestInfo,
} from "../../shared/jmeterStatistics";
import { formatApdexThresholdMs } from "../../shared/jmeterStatistics";

export type JmeterDashboardPdfLatencyBin = { label: string; count: number };

export type JmeterDashboardPdfInput = {
  testInfo: JmeterTestInfo;
  apdex: JmeterApdexRow[];
  statistics: JmeterStatRow[];
  errors: JmeterErrorRow[];
  top5BySampler: JmeterSamplerErrorRow[];
  /** 当前选中环境名，如 dev */
  environment?: string;
  /** 无环境时的项目标识回退 */
  projectName?: string;
  latencyBins?: JmeterDashboardPdfLatencyBin[];
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

function formatGeneratedAt(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}:${sec}`;
}

function buildDonutSvg(okPct: number, koPct: number): string {
  const r = 32;
  const c = 2 * Math.PI * r;
  const okLen = (okPct / 100) * c;
  const koLen = (koPct / 100) * c;
  const label = `${fmt(okPct, 1)}%`;
  if (koPct <= 0) {
    return `<svg class="donut" viewBox="0 0 80 80" aria-hidden="true">
      <circle cx="40" cy="40" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="8"/>
      <circle cx="40" cy="40" r="${r}" fill="none" stroke="#22c55e" stroke-width="8"
        stroke-dasharray="${c} 0" transform="rotate(-90 40 40)"/>
      <text x="40" y="43" text-anchor="middle" class="donut-center">${label}</text>
    </svg>`;
  }
  return `<svg class="donut" viewBox="0 0 80 80" aria-hidden="true">
    <circle cx="40" cy="40" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="8"/>
    <circle cx="40" cy="40" r="${r}" fill="none" stroke="#22c55e" stroke-width="8"
      stroke-dasharray="${okLen} ${c - okLen}" transform="rotate(-90 40 40)"/>
    <circle cx="40" cy="40" r="${r}" fill="none" stroke="#ef4444" stroke-width="8"
      stroke-dasharray="${koLen} ${c - koLen}" stroke-dashoffset="${-okLen}" transform="rotate(-90 40 40)"/>
    <text x="40" y="43" text-anchor="middle" class="donut-center">${label}</text>
  </svg>`;
}

function buildLatencyBars(bins: JmeterDashboardPdfLatencyBin[]): string {
  const active = bins.filter((b) => b.count > 0).slice(0, 14);
  if (!active.length) return "";
  const max = Math.max(...active.map((b) => b.count));
  const bars = active
    .map((b) => {
      const h = max ? Math.round((b.count / max) * 52) : 0;
      return `<div class="lat-bar" title="${esc(b.label)} ms：${b.count}">
        <div class="lat-bar-fill" style="height:${Math.max(2, h)}px"></div>
        <span class="lat-bar-count">${b.count}</span>
      </div>`;
    })
    .join("");
  return `<div class="latency-mini">
    <div class="latency-mini-title">响应时间分布 (ms)</div>
    <div class="latency-bars">${bars}</div>
  </div>`;
}

function buildTestConclusion(samples: number, ko: number, errorPct: number, meanMs: number): string {
  if (ko === 0) {
    return `本次测试共执行 ${samples} 个请求，所有请求均成功（错误率 ${fmt(errorPct, 2)}%），平均响应时间为 ${fmt(meanMs, 0)} ms。系统在当前压力下表现稳定。`;
  }
  return `本次测试共执行 ${samples} 个请求，其中 ${ko} 个失败（错误率 ${fmt(errorPct, 2)}%），平均响应时间为 ${fmt(meanMs, 0)} ms。请结合下方错误汇总进一步排查。`;
}

const STYLES = `
  @page { margin: 20mm; }
  body {
    font-family: "Microsoft YaHei UI", "PingFang SC", "Segoe UI", sans-serif;
    font-size: 10px;
    color: #1e293b;
    margin: 0;
    padding: 18px 22px 24px;
    line-height: 1.45;
    background: #ffffff;
  }
  h1 {
    font-size: 17px;
    margin: 0 0 14px;
    color: #0f172a;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  h2 {
    font-size: 11px;
    margin: 18px 0 8px;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 4px;
    color: #334155;
    font-weight: 650;
  }
  thead { display: table-header-group; }
  .report-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    margin-bottom: 14px;
    background: #f3f4f6;
    border-radius: 6px;
    font-size: 10px;
    color: #4b5563;
  }
  .report-meta strong { color: #111827; font-weight: 650; }
  .kpi-row {
    display: flex;
    gap: 10px;
    margin-bottom: 14px;
  }
  .kpi-card {
    flex: 1 1 0;
    min-width: 0;
    padding: 12px 10px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #fafafa;
    text-align: center;
  }
  .kpi-card--pass {
    background: #f0fdf4;
    border-color: #bbf7d0;
  }
  .kpi-card--error-ok {
    background: #f9fafb;
    border-color: #e5e7eb;
  }
  .kpi-card--error-warn {
    background: #fef2f2;
    border-color: #fecaca;
  }
  .kpi-label {
    font-size: 9px;
    color: #6b7280;
    margin-bottom: 6px;
    white-space: nowrap;
  }
  .kpi-value {
    font-size: 20px;
    font-weight: 750;
    color: #111827;
    font-variant-numeric: tabular-nums;
    font-family: Consolas, "Courier New", ui-monospace, monospace;
    line-height: 1.1;
  }
  .kpi-value--unit {
    font-size: 11px;
    font-weight: 600;
    color: #6b7280;
    margin-left: 2px;
  }
  .info-strip {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 16px;
    padding: 10px 12px;
    margin-bottom: 4px;
    background: #f9fafb;
    border: 1px solid #eef0f2;
    border-radius: 6px;
    font-size: 9px;
    color: #374151;
  }
  .info-strip dt { color: #6b7280; display: inline; }
  .info-strip dt::after { content: "："; }
  .info-strip dd { display: inline; margin: 0; word-break: break-all; }
  .chart-row {
    display: flex;
    align-items: stretch;
    gap: 16px;
    margin: 8px 0 4px;
    flex-wrap: wrap;
  }
  .donut-card {
    flex-shrink: 0;
    width: 116px;
    padding: 10px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .donut-wrap { width: 80px; height: 80px; }
  .donut { width: 100%; height: 100%; }
  .donut-center {
    font-size: 10px;
    font-weight: 700;
    fill: #111827;
    font-family: Consolas, "Courier New", ui-monospace, monospace;
  }
  .dist-list {
    list-style: none;
    margin: 0;
    padding: 8px 0;
    flex: 1 1 120px;
    min-width: 140px;
    font-size: 10px;
    color: #374151;
  }
  .dist-list li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 0;
    border-bottom: 1px solid #f1f5f9;
  }
  .dist-list li:last-child { border-bottom: none; }
  .dist-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dist-dot--ok { background: #22c55e; }
  .dist-dot--ko { background: #ef4444; }
  .dist-dot--tp { background: #6366f1; }
  .dist-list strong { font-weight: 650; color: #111827; }
  .latency-mini {
    flex: 1 1 200px;
    min-width: 180px;
    padding: 8px 10px 6px;
    background: #fafafa;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
  }
  .latency-mini-title {
    font-size: 9px;
    color: #6b7280;
    margin-bottom: 8px;
  }
  .latency-bars {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 64px;
  }
  .lat-bar {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
  }
  .lat-bar-fill {
    width: 100%;
    max-width: 16px;
    background: #94a3b8;
    border-radius: 2px 2px 0 0;
  }
  .lat-bar-count {
    font-size: 7px;
    color: #64748b;
    font-family: Consolas, "Courier New", ui-monospace, monospace;
  }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; table-layout: fixed; }
  table.data-table th,
  table.data-table td {
    border: none;
    border-bottom: 1px solid #eeeeee;
    padding: 7px 6px;
    text-align: left;
    vertical-align: middle;
    color: #1e293b;
  }
  table.data-table thead th {
    background: #f1f5f9;
    font-weight: 650;
    color: #475569;
    border-bottom: 1px solid #e2e8f0;
    white-space: nowrap;
    font-size: 9px;
  }
  table.data-table tbody tr:last-child td { border-bottom: 1px solid #e2e8f0; }
  td.num, th.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-family: Consolas, "Courier New", ui-monospace, monospace;
  }
  tr.total td {
    font-weight: 700;
    background: #f8fafc;
    border-top: 2px solid #cbd5e1;
  }
  th.tx { width: 14%; }
  th.pct-col { width: 7.2%; }
  .detail-section { margin-top: 6px; }
  .report-conclusion {
    margin: 14px 0 4px;
    padding: 0;
    font-size: 10px;
    color: #334155;
    line-height: 1.6;
  }
  .report-conclusion strong { color: #0f172a; }
  @media print {
    body {
      font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    table.data-table th,
    table.data-table td { border-bottom: 1px solid #eeeeee; }
    .report-meta, .kpi-card, .info-strip, .donut-card, .latency-mini {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
`;

export function buildJmeterDashboardPdfHtml(input: JmeterDashboardPdfInput): string {
  const {
    testInfo,
    apdex,
    statistics,
    errors,
    top5BySampler,
    environment,
    projectName,
    latencyBins,
  } = input;
  const total = statistics.find((r) => r.transaction === "Total");
  const ok = total ? total.sampleCount - total.errorCount : 0;
  const ko = total?.errorCount ?? 0;
  const samples = total?.sampleCount ?? 0;
  const okPct = samples ? (ok / samples) * 100 : 0;
  const koPct = samples ? (ko / samples) * 100 : 0;
  const errorPct = total?.errorPct ?? (samples ? (ko / samples) * 100 : 0);
  const meanMs = total?.meanResTime ?? 0;
  const throughput = total?.throughput ?? 0;
  const allPass = ko === 0;
  const envLabel = esc(environment?.trim() || "未指定");
  const projectLine = projectName?.trim()
    ? `<div><dt>项目</dt><dd>${esc(projectName.trim())}</dd></div>`
    : "";
  const generatedAt = formatGeneratedAt();
  const passCardCls = okPct >= 99.9 ? " kpi-card--pass" : "";
  const errCardCls = errorPct <= 0 ? " kpi-card--error-ok" : " kpi-card--error-warn";
  const latencyChart = latencyBins?.length ? buildLatencyBars(latencyBins) : "";

  const statHeaderAllPass = `
          <th class="tx">事务</th>
          <th class="num">样本</th>
          <th class="num">均时(ms)</th>
          <th class="num">最小(ms)</th>
          <th class="num">最大(ms)</th>
          <th class="num">中位(ms)</th>
          <th class="num pct-col">P90(ms)</th>
          <th class="num pct-col">P95(ms)</th>
          <th class="num pct-col">P99(ms)</th>
          <th class="num">吞吐/s</th>
          <th class="num">收KB/s</th>
          <th class="num">发KB/s</th>`;

  const statHeaderWithErrors = `
          <th class="tx">事务</th>
          <th class="num">样本</th>
          <th class="num">失败</th>
          <th class="num">错率%</th>
          <th class="num">均时(ms)</th>
          <th class="num">最小(ms)</th>
          <th class="num">最大(ms)</th>
          <th class="num">中位(ms)</th>
          <th class="num pct-col">P90(ms)</th>
          <th class="num pct-col">P95(ms)</th>
          <th class="num pct-col">P99(ms)</th>
          <th class="num">吞吐/s</th>`;

  const statRows = statistics
    .map((r) => {
      const cls = r.transaction === "Total" ? ' class="total"' : "";
      if (allPass) {
        return `<tr${cls}>
        <td>${esc(r.transaction)}</td>
        <td class="num">${r.sampleCount}</td>
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
      }
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

  const errorsSection =
    ko === 0 && errors.length === 0 && top5BySampler.length === 0
      ? `<div class="report-conclusion"><p><strong>测试结论：</strong>${buildTestConclusion(samples, ko, errorPct, meanMs)}</p></div>`
      : `<h2>错误汇总</h2>
  <table class="data-table">
    <thead>
      <tr>
        <th>异常类型</th>
        <th class="num">错误数</th>
        <th class="num">占比 %</th>
      </tr>
    </thead>
    <tbody>
      ${errors
        .map(
          (e) =>
            `<tr><td>${esc(e.message)}</td><td class="num">${e.count}</td><td class="num">${fmt(e.pct)}</td></tr>`,
        )
        .join("")}
    </tbody>
  </table>

  <h2>Top 5 错误（按采样器）</h2>
  <table class="data-table">
    <thead>
      <tr>
        <th>采样器</th>
        <th>错误摘要</th>
        <th class="num">样本数</th>
      </tr>
    </thead>
    <tbody>
      ${top5BySampler
        .map(
          (e) =>
            `<tr><td>${esc(e.sampler)}</td><td>${esc(e.message)}</td><td class="num">${e.count}</td></tr>`,
        )
        .join("")}
    </tbody>
  </table>
  <div class="report-conclusion"><p><strong>测试结论：</strong>${buildTestConclusion(samples, ko, errorPct, meanMs)}</p></div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><title>API Test Platform 压测报告</title><style>${STYLES}</style></head>
<body>
  <div class="report-meta">
    <span>测试环境：<strong>${envLabel}</strong></span>
    <span>报告生成：<strong>${generatedAt}</strong></span>
  </div>

  <h1>API Test Platform 压测报告</h1>

  <div class="kpi-row">
    <div class="kpi-card">
      <div class="kpi-label">样本数</div>
      <div class="kpi-value">${samples}</div>
    </div>
    <div class="kpi-card${passCardCls}">
      <div class="kpi-label">通过率</div>
      <div class="kpi-value">${fmt(okPct, 1)}<span class="kpi-value--unit">%</span></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">平均响应</div>
      <div class="kpi-value">${fmt(meanMs, 0)}<span class="kpi-value--unit">ms</span></div>
    </div>
    <div class="kpi-card${errCardCls}">
      <div class="kpi-label">错误率</div>
      <div class="kpi-value">${fmt(errorPct, 2)}<span class="kpi-value--unit">%</span></div>
    </div>
  </div>

  <dl class="info-strip">
    ${projectLine}
    <div><dt>源文件</dt><dd>${esc(testInfo.sourceFile)}</dd></div>
    <div><dt>时长</dt><dd>${testInfo.durationMs} ms</dd></div>
    <div><dt>开始时间</dt><dd>${esc(testInfo.startTime)}</dd></div>
    <div><dt>结束时间</dt><dd>${esc(testInfo.endTime)}</dd></div>
  </dl>

  <h2>请求结果分布</h2>
  <div class="chart-row">
    <div class="donut-card">
      <div class="donut-wrap">${buildDonutSvg(okPct, koPct)}</div>
    </div>
    <ul class="dist-list">
      <li><span class="dist-dot dist-dot--ok" aria-hidden="true"></span><span>成功：<strong>${ok}</strong> 次</span></li>
      <li><span class="dist-dot dist-dot--ko" aria-hidden="true"></span><span>失败：<strong>${ko}</strong> 次</span></li>
      <li><span class="dist-dot dist-dot--tp" aria-hidden="true"></span><span>吞吐：<strong>${fmt(throughput)}</strong> req/s</span></li>
    </ul>
    ${latencyChart}
  </div>

  <div class="detail-section">
    <h2>事务统计</h2>
    <table class="data-table">
      <thead>
        <tr>${allPass ? statHeaderAllPass : statHeaderWithErrors}
        </tr>
      </thead>
      <tbody>${statRows}</tbody>
    </table>

    <h2>APDEX（应用性能指数）</h2>
    <table class="data-table">
      <thead>
        <tr>
          <th class="num">Apdex</th>
          <th class="num">T（容忍阈值）</th>
          <th class="num">F（沮丧阈值）</th>
          <th>标签</th>
        </tr>
      </thead>
      <tbody>${apdexRows}</tbody>
    </table>

    ${errorsSection}
  </div>
</body>
</html>`;
}