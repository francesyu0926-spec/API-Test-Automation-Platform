import { useMemo, useRef, useState } from "react";

import type { HttpBenchmarkReport } from "../../shared/apiWorkbenchTypes";
import AggregateReportTable, {
  buildAggregateRows,
  primaryBenchmarkError,
  summarizeBenchmarkErrors,
} from "./aggregateReportTable";
import BenchmarkSampleTable from "./benchmarkSampleTable";
import { LatencyDistributionChart, StatusCodeChart } from "./benchmarkCharts";
import { capturePerfChartImages } from "./benchmarkChartExport";
import { formatPerfStartedAtLocal } from "./perfDateTime";
import { buildPerfReportPdfHtml } from "./perfReportPdfHtml";

type Props = {
  report: HttpBenchmarkReport | null;
  running: boolean;
  project: string;
  onToast: (msg: string) => void;
  onOpenHistory?: () => void;
};

export default function BenchmarkResults({ report, running, project, onToast, onOpenHistory }: Props) {
  const reportRootRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  const measuredDurations = useMemo(
    () => (report?.samples ?? []).filter((s) => !s.warmup).map((s) => s.durationMs),
    [report],
  );
  const aggregateRows = useMemo(() => buildAggregateRows(report), [report]);
  const errorSummary = useMemo(() => (report ? summarizeBenchmarkErrors(report) : []), [report]);
  const primaryError = useMemo(() => primaryBenchmarkError(report), [report]);

  const onSave = async () => {
    if (!report || !project || saving) return;
    setSaving(true);
    try {
      await new Promise<void>((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      });
      await new Promise((r) => setTimeout(r, 80));
      const charts = reportRootRef.current
        ? await capturePerfChartImages(reportRootRef.current)
        : {};
      const visualHtml = buildPerfReportPdfHtml({
        report,
        aggregateRows,
        errorSummary,
        charts,
        projectId: project,
      });
      const res = await window.atp.savePerfReport(project, report, visualHtml);
      if (!res.ok) {
        onToast("保存失败");
        return;
      }
      if (res.cancelled) {
        onToast(`已取消导出 PDF；原始数据仍保存在 ${res.relativePath}`);
        return;
      }
      if (res.pdfFilePath) {
        onToast(`PDF 已保存：${res.pdfFilePath}（JSON：${res.relativePath}）`);
      } else if (res.error) {
        onToast(`JSON 已保存：${res.relativePath}；PDF 失败：${res.error}`);
      } else {
        onToast(`数据已保存：${res.relativePath}`);
      }
    } catch (e) {
      onToast(e instanceof Error ? e.message : "导出 PDF 失败");
    } finally {
      setSaving(false);
    }
  };

  const onCopySummary = async () => {
    if (!report) return;
    const s = report.stats;
    const o = report.options;
    const text = [
      `${report.request.method} ${report.request.url}`,
      `线程 ${o.concurrency}，循环 ${o.loops ?? "—"}，Ramp-Up ${o.rampUpSec ?? 0}s`,
      `样本 ${s.samples}，成功 ${s.success}，失败 ${s.failed}，${s.wallMs} ms，${s.rps} req/s`,
      `延迟 ms — min ${s.latency.min} · avg ${s.latency.avg} · p50 ${s.latency.p50} · p95 ${s.latency.p95} · p99 ${s.latency.p99} · max ${s.latency.max}`,
      `状态码：${JSON.stringify(s.statusCodes)}`,
      errorSummary.length
        ? `错误：\n${errorSummary.map((e) => `  ${e.count}× ${e.message}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    await window.atp.copyText(text);
    onToast("已复制性能摘要");
  };

  if (running) {
    return (
      <div className="loadtest-report-running">
        <AggregateReportTable rows={buildAggregateRows(null)} />
        <div className="loadtest-report-placeholder loadtest-report-placeholder--active">
          <div className="loadtest-report-spinner" aria-hidden />
          <p className="loadtest-report-placeholder-title">压测执行中…</p>
          <p className="hint">线程组正在按 Ramp-Up 间隔依次启动并发送请求</p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="workbench-perf loadtest-report loadtest-report--idle">
        <div className="loadtest-report-idle-guide">
          <p className="loadtest-report-placeholder-title">尚未运行压测</p>
          <p className="hint loadtest-report-empty-hint">
            配置线程组与 HTTP 请求后，点击工具栏「启动压测」查看本次指标；历史记录与合并导出请打开顶栏「压测历史」。
          </p>
          <ol className="loadtest-report-steps hint">
            <li>线程组 — 设置线程数、Ramp-Up、循环</li>
            <li>HTTP 请求 — 填写 URL 或从集合导入</li>
            <li>点击「启动压测」查看聚合表与分布图</li>
          </ol>
          {onOpenHistory ? (
            <button type="button" className="nav-btn nav-btn--accent loadtest-report-history-cta" onClick={onOpenHistory}>
              打开压测历史
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const o = report.options;
  const s = report.stats;
  const requestCaption = report.request.name?.trim() || `${report.request.method} ${report.request.url}`;
  const allOk = s.failed === 0;
  const finishedAt = formatPerfStartedAtLocal(report.startedAt);

  return (
    <div ref={reportRootRef} className="workbench-perf loadtest-report">
      <header className="loadtest-report-hero">
        <div className="loadtest-report-hero-top">
          <div className="loadtest-report-hero-request">
            <span
              className={`loadtest-report-pill${allOk ? " loadtest-report-pill--ok" : " loadtest-report-pill--err"}`}
            >
              {allOk ? "全部成功" : `${s.failed} 失败`}
            </span>
            <span className={`method-tag method-${report.request.method.toLowerCase()}`}>{report.request.method}</span>
            <span className="loadtest-report-hero-url" title={report.request.url}>
              {report.request.name || report.request.url}
            </span>
          </div>
          <div className="loadtest-report-head-actions">
            {onOpenHistory ? (
              <button type="button" className="nav-btn" onClick={onOpenHistory}>
                压测历史…
              </button>
            ) : null}
            <button
              type="button"
              className="nav-btn nav-btn--accent"
              disabled={!project || saving}
              onClick={() => void onSave()}
            >
              {saving ? "正在准备 PDF…" : "导出本次 PDF"}
            </button>
            <button type="button" className="nav-btn" onClick={() => void onCopySummary()}>
              复制摘要
            </button>
          </div>
        </div>
        <dl className="loadtest-report-hero-stats">
          <div>
            <dt>样本</dt>
            <dd>{s.samples}</dd>
          </div>
          <div>
            <dt>吞吐</dt>
            <dd className="loadtest-report-stat-accent">{s.rps} req/s</dd>
          </div>
          <div>
            <dt>p95</dt>
            <dd>{s.latency.p95} ms</dd>
          </div>
          <div>
            <dt>p99</dt>
            <dd>{s.latency.p99} ms</dd>
          </div>
          <div>
            <dt>avg</dt>
            <dd>{s.latency.avg} ms</dd>
          </div>
        </dl>
        <p className="loadtest-report-hero-meta hint">
          线程 {o.concurrency} · 循环 {o.loops ?? "—"} · Ramp-Up {o.rampUpSec ?? 0}s · 壁钟 {s.wallMs} ms · {finishedAt}
        </p>
      </header>

      <div className="loadtest-report-current">
        <AggregateReportTable rows={aggregateRows} errorTooltip={primaryError} caption={requestCaption} compactHead />

        {errorSummary.length > 0 ? (
          <section className="loadtest-error-panel" role="alert" aria-labelledby="loadtest-error-title">
            <h4 id="loadtest-error-title" className="loadtest-error-panel-title">
              错误原因
              <span className="loadtest-error-panel-badge">
                {report.stats.failed}/{report.stats.samples} 失败
              </span>
            </h4>
            <ul className="loadtest-error-list">
              {errorSummary.map((item) => (
                <li key={item.message} className="loadtest-error-item">
                  <span className="loadtest-error-count">{item.count}</span>
                  <span className="loadtest-error-msg">{item.message}</span>
                </li>
              ))}
            </ul>
            {primaryError?.includes("ECONNREFUSED") || primaryError?.includes("ENOTFOUND") ? (
              <p className="hint loadtest-error-hint">请检查 URL、网络与代理；若 URL 含变量，确认环境 dev 已填写。</p>
            ) : primaryError?.includes("HTTP") ? (
              <p className="hint loadtest-error-hint">
                服务端返回非 2xx。请查看下方「请求样本」中的状态码与说明。
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="loadtest-report-charts" aria-labelledby="loadtest-charts-title">
          <h4 id="loadtest-charts-title" className="loadtest-report-block-title">
            分布图
          </h4>
          <div className="grid-2 perf-detail-grid perf-charts-grid">
            <div className="perf-chart-panel">
              <h4 className="sub-title">延迟分布</h4>
              <LatencyDistributionChart durationsMs={measuredDurations} bucketMs={50} />
            </div>
            <div className="perf-chart-panel">
              <h4 className="sub-title">状态码</h4>
              <StatusCodeChart statusCodes={report.stats.statusCodes} />
            </div>
          </div>
        </section>

        <BenchmarkSampleTable report={report} />
      </div>
    </div>
  );
}