import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { HttpBenchmarkReport } from "../../shared/apiWorkbenchTypes";
import AggregateReportTable, {
  buildAggregateRows,
  summarizeBenchmarkErrors,
} from "./aggregateReportTable";
import { LatencyDistributionChart, StatusCodeChart } from "./benchmarkCharts";
import { capturePerfChartImages } from "./benchmarkChartExport";
import {
  buildAggregateRowsMulti,
  collectMeasuredDurations,
  endpointKey,
  mergeErrorSummaries,
  mergeReportsStats,
  mergeStatusCodes,
} from "./perfReportMerge";
import { buildMultiPerfReportPdfHtml, buildPerfReportPdfHtml } from "./perfReportPdfHtml";

type PerfListItem = Awaited<ReturnType<typeof window.atp.listPerfReports>>[number];

type Props = {
  project: string;
  currentReport: HttpBenchmarkReport | null;
  onToast: (msg: string) => void;
  onHistoryCountChange?: (count: number) => void;
};

type GroupMode = "runs" | "endpoints";

const HISTORY_LIMIT = 200;

export default function LoadTestHistoryPanel({
  project,
  currentReport,
  onToast,
  onHistoryCountChange,
}: Props) {
  const [history, setHistory] = useState<PerfListItem[]>([]);
  const [archivePath, setArchivePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [includeCurrent, setIncludeCurrent] = useState(false);
  const [groupMode, setGroupMode] = useState<GroupMode>("runs");
  const [selectedEndpoints, setSelectedEndpoints] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [rowExporting, setRowExporting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    if (!project) {
      setHistory([]);
      setArchivePath("");
      return;
    }
    setLoading(true);
    try {
      const [list, dir] = await Promise.all([
        window.atp.listPerfReports(project, HISTORY_LIMIT),
        window.atp.getPerfReportsDir(project),
      ]);
      setHistory(list);
      setArchivePath(dir.relative);
      onHistoryCountChange?.(list.length);
    } finally {
      setLoading(false);
    }
  }, [project, onHistoryCountChange]);

  useEffect(() => {
    void reload();
  }, [reload, currentReport?.id]);

  const endpointGroups = useMemo(() => {
    const map = new Map<string, PerfListItem[]>();
    for (const item of history) {
      const key = `${item.method} ${item.url}`;
      const bucket = map.get(key) ?? [];
      bucket.push(item);
      map.set(key, bucket);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [history]);

  const resolvedFileSet = useMemo(() => {
    if (groupMode === "endpoints") {
      const set = new Set<string>();
      for (const [key, items] of endpointGroups) {
        if (selectedEndpoints.has(key)) {
          for (const it of items) set.add(it.file);
        }
      }
      return set;
    }
    return selectedFiles;
  }, [groupMode, selectedFiles, selectedEndpoints, endpointGroups]);

  const fileSelectionKey = useMemo(() => [...resolvedFileSet].sort().join("|"), [resolvedFileSet]);

  const toggleFile = (file: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const toggleEndpoint = (key: string) => {
    setSelectedEndpoints((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    if (groupMode === "endpoints") {
      setSelectedEndpoints(new Set(endpointGroups.map(([key]) => key)));
      return;
    }
    setSelectedFiles(new Set(history.map((h) => h.file)));
  };

  const clearSelection = () => {
    setSelectedFiles(new Set());
    setSelectedEndpoints(new Set());
    setIncludeCurrent(false);
  };

  const [loadedReports, setLoadedReports] = useState<HttpBenchmarkReport[]>([]);

  useEffect(() => {
    if (!project || !fileSelectionKey) {
      setLoadedReports([]);
      return;
    }
    let cancelled = false;
    void window.atp.loadPerfReports(project, fileSelectionKey.split("|")).then((docs) => {
      if (!cancelled) setLoadedReports(docs);
    });
    return () => {
      cancelled = true;
    };
  }, [project, fileSelectionKey]);

  const combinedReports = useMemo(() => {
    const byId = new Map<string, HttpBenchmarkReport>();
    for (const r of loadedReports) byId.set(r.id, r);
    if (includeCurrent && currentReport) byId.set(currentReport.id, currentReport);
    return [...byId.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }, [loadedReports, includeCurrent, currentReport]);

  const mergedStats = useMemo(
    () => (combinedReports.length ? mergeReportsStats(combinedReports) : null),
    [combinedReports],
  );
  const aggregateRows = useMemo(() => buildAggregateRowsMulti(combinedReports), [combinedReports]);
  const measuredDurations = useMemo(() => collectMeasuredDurations(combinedReports), [combinedReports]);
  const mergedStatusCodes = useMemo(() => mergeStatusCodes(combinedReports), [combinedReports]);

  const exportReportsToPdf = async (reports: HttpBenchmarkReport[], suggestedName: string) => {
    if (!project || reports.length === 0) return;
    setExporting(true);
    try {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      await new Promise((r) => setTimeout(r, 100));
      const charts = captureRef.current ? await capturePerfChartImages(captureRef.current) : {};
      const html =
        reports.length > 1
          ? buildMultiPerfReportPdfHtml({
              projectId: project,
              reports,
              aggregateRows: buildAggregateRowsMulti(reports),
              errorSummary: mergeErrorSummaries(reports),
              charts,
            })
          : buildPerfReportPdfHtml({
              report: reports[0],
              aggregateRows: buildAggregateRows(reports[0]),
              errorSummary: summarizeBenchmarkErrors(reports[0]),
              charts,
              projectId: project,
            });
      const res = await window.atp.exportPerfReportPdfDialog(project, html, suggestedName);
      if (res.cancelled) {
        onToast("已取消导出");
        return;
      }
      if (res.pdfFilePath) onToast(`报告已保存：${res.pdfFilePath}`);
      else onToast(res.error ?? "导出失败");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const onExportMerged = async () => {
    if (!project || combinedReports.length === 0) {
      onToast("请至少选择一条压测记录");
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const name =
      combinedReports.length > 1
        ? `perf-merged-${combinedReports.length}runs-${stamp}`
        : `perf-${combinedReports[0].startedAt.replace(/[:.]/g, "-").slice(0, 19)}-${combinedReports[0].id}`;
    await exportReportsToPdf(combinedReports, name);
  };

  const onExportRowPdf = async (file: string) => {
    if (!project || rowExporting) return;
    setRowExporting(file);
    try {
      const docs = await window.atp.loadPerfReports(project, [file]);
      const report = docs[0];
      if (!report) {
        onToast("无法读取该记录");
        return;
      }
      const name = `perf-${report.startedAt.replace(/[:.]/g, "-").slice(0, 19)}-${report.id}`;
      await exportReportsToPdf([report], name);
    } finally {
      setRowExporting(null);
    }
  };

  const onExportJson = async () => {
    if (!project || combinedReports.length === 0) {
      onToast("请至少选择一条记录");
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const body =
      combinedReports.length === 1
        ? `${JSON.stringify(combinedReports[0], null, 2)}\n`
        : `${JSON.stringify(combinedReports, null, 2)}\n`;
    const res = await window.atp.saveTextWithDialog({
      defaultPath: `perf-export-${combinedReports.length}-${stamp}.json`,
      content: body,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (res.cancelled) return;
    if (res.filePath) onToast(`JSON 已保存：${res.filePath}`);
    else onToast(res.error ?? "导出失败");
  };

  const onCopyRowSummary = async (file: string) => {
    if (!project) return;
    const docs = await window.atp.loadPerfReports(project, [file]);
    const report = docs[0];
    if (!report) {
      onToast("无法读取该记录");
      return;
    }
    const text = formatPerfSummary(report);
    await window.atp.copyText(text);
    onToast("已复制摘要");
  };

  const onOpenArchiveDir = async () => {
    if (!project) return;
    const dir = await window.atp.getPerfReportsDir(project);
    const err = await window.atp.openPath(dir.absolute);
    if (err) onToast(err);
  };

  const onDeleteSelected = async () => {
    if (!project) return;
    const files = [...resolvedFileSet];
    if (!files.length) {
      onToast("请先勾选要删除的记录");
      return;
    }
    if (!window.confirm(`确定删除所选 ${files.length} 条压测记录？（同时删除同名的 PDF，不可恢复）`)) return;
    setDeleting(true);
    try {
      const res = await window.atp.deletePerfReports(project, files);
      if (res.deleted > 0) {
        onToast(`已删除 ${res.deleted} 条记录`);
        clearSelection();
        await reload();
      } else onToast(res.error ?? "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  if (!project) return null;

  const selectionCount = combinedReports.length;
  const totalSamples = history.reduce((n, h) => n + h.samples, 0);
  const totalFailed = history.reduce((n, h) => n + h.failed, 0);

  return (
    <div className="loadtest-history-page">
      <header className="loadtest-history-hero">
        <div className="loadtest-history-hero-text">
          <h3 className="loadtest-history-title">压测历史</h3>
          <p className="hint loadtest-history-lede">
            内置压测与 JMX 执行成功后自动写入 JSON
            {archivePath ? (
              <>
                {" "}
                · 目录 <code className="loadtest-history-path">{archivePath}</code>
              </>
            ) : null}
          </p>
        </div>
        <dl className="loadtest-history-stats">
          <div>
            <dt>存档次数</dt>
            <dd>{history.length}</dd>
          </div>
          <div>
            <dt>累计样本</dt>
            <dd>{totalSamples}</dd>
          </div>
          <div>
            <dt>累计失败</dt>
            <dd className={totalFailed > 0 ? "loadtest-history-stat-warn" : undefined}>{totalFailed}</dd>
          </div>
        </dl>
      </header>

      <section className="loadtest-merge-panel loadtest-history-panel" aria-labelledby="loadtest-history-list-title">
        <div className="loadtest-merge-control">
          <div className="loadtest-merge-control-start">
            <h4 id="loadtest-history-list-title" className="loadtest-merge-title">
              记录列表
            </h4>
            <div className="loadtest-merge-tabs" role="tablist" aria-label="选择方式">
              <button
                type="button"
                role="tab"
                className={`loadtest-merge-tab${groupMode === "runs" ? " active" : ""}`}
                aria-selected={groupMode === "runs"}
                onClick={() => setGroupMode("runs")}
              >
                按执行
              </button>
              <button
                type="button"
                role="tab"
                className={`loadtest-merge-tab${groupMode === "endpoints" ? " active" : ""}`}
                aria-selected={groupMode === "endpoints"}
                onClick={() => setGroupMode("endpoints")}
              >
                按接口
              </button>
            </div>
            {selectionCount > 0 ? (
              <span className="loadtest-merge-selection-pill" aria-live="polite">
                已选 <strong>{selectionCount}</strong>
              </span>
            ) : null}
          </div>
          <div className="loadtest-merge-control-actions loadtest-history-actions">
            <button type="button" className="nav-btn nav-btn--compact" onClick={selectAll}>
              {groupMode === "endpoints" ? "全选接口" : "全选执行"}
            </button>
            <button
              type="button"
              className="nav-btn nav-btn--compact"
              disabled={!selectionCount && !includeCurrent}
              onClick={clearSelection}
            >
              清除
            </button>
            <span className="loadtest-merge-control-sep" aria-hidden />
            <button type="button" className="nav-btn nav-btn--compact" disabled={loading} onClick={() => void reload()}>
              刷新
            </button>
            <button type="button" className="nav-btn nav-btn--compact" onClick={() => void onOpenArchiveDir()}>
              打开存档目录
            </button>
            <button
              type="button"
              className="nav-btn nav-btn--compact"
              disabled={!selectionCount || exporting}
              onClick={() => void onExportJson()}
            >
              导出 JSON
            </button>
            <button
              type="button"
              className="nav-btn nav-btn--compact nav-btn--danger"
              disabled={!resolvedFileSet.size || deleting}
              onClick={() => void onDeleteSelected()}
            >
              {deleting ? "删除中…" : "删除所选"}
            </button>
            <button
              type="button"
              className={`nav-btn nav-btn--compact${selectionCount > 0 ? " nav-btn--accent" : ""}`}
              disabled={exporting || selectionCount === 0}
              onClick={() => void onExportMerged()}
            >
              {exporting
                ? "生成 PDF…"
                : selectionCount > 0
                  ? `合并导出 PDF (${selectionCount})`
                  : "合并导出 PDF"}
            </button>
          </div>
        </div>

        {currentReport ? (
          <label className="loadtest-merge-current">
            <input
              type="checkbox"
              checked={includeCurrent}
              onChange={(e) => setIncludeCurrent(e.target.checked)}
            />
            包含当前会话（尚未单独导出 PDF 也可合并）
            <span className="hint">
              {currentReport.request.method} {currentReport.request.name || currentReport.request.url}
            </span>
          </label>
        ) : null}

        {groupMode === "runs" ? (
          <div className="loadtest-merge-table-wrap">
            {loading ? <p className="hint">加载历史记录…</p> : null}
            {!loading && history.length === 0 ? (
              <p className="hint">暂无已保存压测记录。完成一次内置压测后将自动出现在此列表。</p>
            ) : null}
            {history.length > 0 ? (
              <table className="loadtest-merge-table loadtest-history-table">
                <thead>
                  <tr>
                    <th className="loadtest-merge-check-col" aria-label="选择" />
                    <th>时间</th>
                    <th>接口</th>
                    <th className="num">样本</th>
                    <th className="num">成功</th>
                    <th className="num">失败</th>
                    <th className="num">吞吐</th>
                    <th className="loadtest-history-actions-col">导出</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.file} className={selectedFiles.has(row.file) ? "loadtest-merge-row--selected" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedFiles.has(row.file)}
                          onChange={() => toggleFile(row.file)}
                          aria-label={`选择 ${row.startedAt}`}
                        />
                      </td>
                      <td className="loadtest-merge-time">{row.startedAt.replace("T", " ").slice(0, 19)}</td>
                      <td className="loadtest-merge-endpoint" title={row.url}>
                        <span className={`method-tag method-${row.method.toLowerCase()}`}>{row.method}</span>
                        {row.name || row.url}
                      </td>
                      <td className="num">{row.samples}</td>
                      <td className="num">{row.success}</td>
                      <td className="num">{row.failed}</td>
                      <td className="num">{row.rps}/s</td>
                      <td className="loadtest-history-row-actions">
                        <button
                          type="button"
                          className="nav-btn nav-btn--compact"
                          disabled={rowExporting === row.file || exporting}
                          onClick={() => void onExportRowPdf(row.file)}
                        >
                          {rowExporting === row.file ? "…" : "PDF"}
                        </button>
                        <button
                          type="button"
                          className="nav-btn nav-btn--compact"
                          onClick={() => void onCopyRowSummary(row.file)}
                        >
                          摘要
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        ) : (
          <ul className="loadtest-merge-endpoints">
            {endpointGroups.map(([key, items]) => (
              <li key={key} className={selectedEndpoints.has(key) ? "loadtest-merge-endpoint-item--selected" : ""}>
                <label className="loadtest-merge-endpoint-item">
                  <input
                    type="checkbox"
                    checked={selectedEndpoints.has(key)}
                    onChange={() => toggleEndpoint(key)}
                  />
                  <span className="loadtest-merge-endpoint-label" title={key}>
                    {key}
                  </span>
                  <span className="hint loadtest-merge-endpoint-meta">{items.length} 次执行</span>
                </label>
              </li>
            ))}
            {!endpointGroups.length && !loading ? <li className="hint">暂无历史接口记录</li> : null}
          </ul>
        )}

        {combinedReports.length > 0 ? (
          <div className="loadtest-merge-preview">
            {mergedStats ? (
              <div className="loadtest-merge-summary-chips">
                <span className="loadtest-merge-chip">
                  <strong>{combinedReports.length}</strong> 次执行
                </span>
                <span className="loadtest-merge-chip">
                  <strong>{uniqueEndpointCount(combinedReports)}</strong> 个接口
                </span>
                <span className="loadtest-merge-chip">
                  <strong>{mergedStats.samples}</strong> 样本
                </span>
                <span className="loadtest-merge-chip loadtest-merge-chip--accent">
                  <strong>{mergedStats.rps}</strong> req/s
                </span>
              </div>
            ) : null}
            <AggregateReportTable rows={aggregateRows} caption={`已选 ${combinedReports.length} 条`} compactHead />
            <h5 className="loadtest-report-block-title">合并分布图</h5>
            <div ref={captureRef} className="grid-2 perf-charts-grid loadtest-merge-charts">
              <div className="perf-chart-panel">
                <h4 className="sub-title">延迟分布</h4>
                <LatencyDistributionChart durationsMs={measuredDurations} bucketMs={50} />
              </div>
              <div className="perf-chart-panel">
                <h4 className="sub-title">状态码</h4>
                <StatusCodeChart statusCodes={mergedStatusCodes} />
              </div>
            </div>
          </div>
        ) : (
          <p className="hint loadtest-merge-empty">勾选上方记录后，这里显示合并预览并可导出 PDF / JSON。</p>
        )}
      </section>
    </div>
  );
}

function uniqueEndpointCount(reports: HttpBenchmarkReport[]): number {
  return new Set(reports.map(endpointKey)).size;
}

function formatPerfSummary(report: HttpBenchmarkReport): string {
  const s = report.stats;
  const o = report.options;
  const errors = summarizeBenchmarkErrors(report);
  return [
    `${report.request.method} ${report.request.url}`,
    `线程 ${o.concurrency}，循环 ${o.loops ?? "—"}，Ramp-Up ${o.rampUpSec ?? 0}s`,
    `样本 ${s.samples}，成功 ${s.success}，失败 ${s.failed}，${s.wallMs} ms，${s.rps} req/s`,
    `延迟 ms — min ${s.latency.min} · avg ${s.latency.avg} · p50 ${s.latency.p50} · p95 ${s.latency.p95} · p99 ${s.latency.p99} · max ${s.latency.max}`,
    `状态码：${JSON.stringify(s.statusCodes)}`,
    errors.length ? `错误：\n${errors.map((e) => `  ${e.count}× ${e.message}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}