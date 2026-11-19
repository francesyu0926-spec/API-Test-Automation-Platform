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
import ConfirmDialog from "./ConfirmDialog";
import PerfSummaryDialog, { perfSummaryFileName } from "./PerfSummaryDialog";
import { formatPerfSummary } from "./perfSummaryFormat";
import { resolvePerfReportJmxXml } from "./perfReportJmxExport";
import { archiveJmeterJtlToPerf } from "./jmeterPerfArchive";
import { buildHtmlForPerfReportPdf } from "./perfReportHtmlForPdf";
import { buildMultiPerfReportPdfHtml } from "./perfReportPdfHtml";
import { formatPerfStartedAtLocal, perfStartedAtInstant } from "./perfDateTime";
import type { HttpBenchmarkJtlEndpoint } from "../../shared/apiWorkbenchTypes";
import {
  formatJtlEndpointLine,
  jtlEndpointKey,
  jtlEndpointsFromAggregate,
} from "../../shared/jtlEndpoints";
import { loadPersistedJtlStreamMode } from "./jtlStreamModePrefs";

type PerfListItem = Awaited<ReturnType<typeof window.atp.listPerfReports>>[number];

function reportToListRow(file: string, report: HttpBenchmarkReport): PerfListItem {
  return {
    id: report.id,
    file,
    startedAt: report.startedAt,
    method: report.request.method,
    url: report.request.url,
    name: report.request.name,
    samples: report.stats.samples,
    success: report.stats.success,
    failed: report.stats.failed,
    rps: report.stats.rps,
    jtlEndpoints: report.jtlEndpoints,
  };
}

async function fetchPerfHistoryList(project: string, limit: number): Promise<PerfListItem[]> {
  let list = await window.atp.listPerfReports(project, limit);
  if (list.length) return list;

  const jsonFiles = await window.atp.listProjectPerfJsonFiles(project);
  if (jsonFiles.length) {
    const rows: PerfListItem[] = [];
    for (const file of jsonFiles.slice(0, limit)) {
      const docs = await window.atp.loadPerfReports(project, [file]);
      const doc = docs[0];
      if (doc) rows.push(reportToListRow(file, doc));
    }
    if (rows.length) return rows;
  }

  const jtlPaths = await window.atp.findJmeterResultJtlFiles(project);
  let imported = 0;
  for (const jtl of jtlPaths.slice(0, 12)) {
    const res = await archiveJmeterJtlToPerf(project, jtl);
    if (res.ok) imported += 1;
  }
  if (imported > 0) {
    list = await window.atp.listPerfReports(project, limit);
    if (list.length) return list;
    const afterFiles = await window.atp.listProjectPerfJsonFiles(project);
    const rows: PerfListItem[] = [];
    for (const file of afterFiles.slice(0, limit)) {
      const docs = await window.atp.loadPerfReports(project, [file]);
      const doc = docs[0];
      if (doc) rows.push(reportToListRow(file, doc));
    }
    if (rows.length) return rows;
  }

  return [];
}

type Props = {
  project: string;
  active?: boolean;
  currentReport: HttpBenchmarkReport | null;
  onToast: (msg: string) => void;
  onHistoryCountChange?: (count: number) => void;
  onNavigateTab?: (tab: "config" | "jmeterRun") => void;
  /** 引导用户到侧栏切换项目 */
  onFocusProjectSelect?: () => void;
  /** 展示用项目名（与左上角下拉一致） */
  projectDisplayName?: string;
  /** 与压测配置当前环境一致，写入 PDF */
  environment?: string;
};

type GroupMode = "runs" | "endpoints";

const HISTORY_LIMIT = 200;

export default function LoadTestHistoryPanel({
  project,
  active = true,
  currentReport,
  onToast,
  onHistoryCountChange,
  onNavigateTab,
  onFocusProjectSelect,
  projectDisplayName,
  environment,
}: Props) {
  const [history, setHistory] = useState<PerfListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [includeCurrent, setIncludeCurrent] = useState(false);
  const [groupMode, setGroupMode] = useState<GroupMode>("runs");
  const [selectedEndpoints, setSelectedEndpoints] = useState<Set<string>>(new Set());
  /** 旧 perf.json 无 jtlEndpoints 时，按需从 sourceJtl 解析 */
  const [jtlEndpointsByFile, setJtlEndpointsByFile] = useState<Record<string, HttpBenchmarkJtlEndpoint[]>>({});
  const [exporting, setExporting] = useState(false);
  const [rowExporting, setRowExporting] = useState<string | null>(null);
  const [rowJmxExporting, setRowJmxExporting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [summaryDialog, setSummaryDialog] = useState<{
    title: string;
    text: string;
    fileName: string;
    report: HttpBenchmarkReport;
  } | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    if (!project) {
      setHistory([]);
      return;
    }
    setLoading(true);
    try {
      const list = await fetchPerfHistoryList(project, HISTORY_LIMIT);
      setHistory(list);
      onHistoryCountChange?.(list.length);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "加载压测历史失败");
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [project, onHistoryCountChange]);

  useEffect(() => {
    void reload();
  }, [reload, currentReport?.id]);

  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  useEffect(() => {
    if (!project || !active) return;
    const missing = history.filter(
      (h) =>
        h.method.toUpperCase() === "JMX" &&
        !(h.jtlEndpoints?.length || jtlEndpointsByFile[h.file]?.length),
    );
    if (!missing.length) return;
  let cancelled = false;
    void (async () => {
      const files = missing.map((h) => h.file);
      const reports = await window.atp.loadPerfReports(project, files);
      const mode = loadPersistedJtlStreamMode();
      const patch: Record<string, HttpBenchmarkJtlEndpoint[]> = {};
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const report = reports[i];
        if (!report) continue;
        if (report.jtlEndpoints?.length) {
          patch[file] = report.jtlEndpoints;
          continue;
        }
        const jtl = report.provenance?.sourceJtl?.trim();
        if (!jtl) continue;
        try {
          const agg = await window.atp.aggregateJtlFile(jtl, mode);
          const eps = jtlEndpointsFromAggregate(agg);
          if (eps.length) patch[file] = eps;
        } catch {
          /* JTL 不可读则跳过 */
        }
      }
      if (!cancelled && Object.keys(patch).length) {
        setJtlEndpointsByFile((prev) => ({ ...prev, ...patch }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project, active, history, jtlEndpointsByFile]);

  type EndpointGroup = {
    key: string;
    ep: HttpBenchmarkJtlEndpoint;
    runs: PerfListItem[];
  };

  const endpointGroups = useMemo((): EndpointGroup[] => {
    const map = new Map<string, EndpointGroup>();
    for (const item of history) {
      const jmxEps = jtlEndpointsForListRow(item, jtlEndpointsByFile);
      if (jmxEps.length) {
        for (const ep of jmxEps) {
          const key = jtlEndpointKey(ep);
          const group = map.get(key) ?? { key, ep, runs: [] };
          if (!group.runs.some((r) => r.file === item.file)) group.runs.push(item);
          map.set(key, group);
        }
        continue;
      }
      if (item.method.toUpperCase() === "JMX") continue;
      const key = `${item.method}\t${item.url}\t${item.name ?? ""}`;
      const ep: HttpBenchmarkJtlEndpoint = {
        label: item.name?.trim() || item.url,
        method: item.method,
        url: item.url,
        samples: item.samples,
      };
      const group = map.get(key) ?? { key, ep, runs: [] };
      group.runs.push(item);
      map.set(key, group);
    }
    return [...map.values()].sort((a, b) =>
      formatJtlEndpointLine(a.ep).localeCompare(formatJtlEndpointLine(b.ep), "zh-CN"),
    );
  }, [history, jtlEndpointsByFile]);

  const resolvedFileSet = useMemo(() => {
    if (groupMode === "endpoints") {
      const set = new Set<string>();
      for (const group of endpointGroups) {
        if (selectedEndpoints.has(group.key)) {
          for (const it of group.runs) set.add(it.file);
        }
      }
      return set;
    }
    return selectedFiles;
  }, [groupMode, selectedFiles, selectedEndpoints, endpointGroups]);

  const fileSelectionKey = useMemo(() => [...resolvedFileSet].sort().join("|"), [resolvedFileSet]);

  useEffect(() => {
    if (!fileSelectionKey) setPreviewExpanded(false);
  }, [fileSelectionKey]);

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
      setSelectedEndpoints(new Set(endpointGroups.map((g) => g.key)));
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
          : await buildHtmlForPerfReportPdf(reports[0]!, project, {
              aggregateRows: buildAggregateRows(reports[0]!),
              errorSummary: summarizeBenchmarkErrors(reports[0]!),
              charts,
              environment,
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

  const onOpenRowPdf = async (file: string) => {
    if (!project || rowExporting) return;
    setRowExporting(file);
    try {
      const docs = await window.atp.loadPerfReports(project, [file]);
      const report = docs[0];
      if (!report) {
        onToast("无法读取该记录");
        return;
      }
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const html = await buildHtmlForPerfReportPdf(report, project, { environment });
      const res = await window.atp.openPerfReportPdf(project, file, html, true);
      if (!res.ok) {
        onToast(res.error ?? "无法打开 PDF");
        return;
      }
      if (res.created || res.regenerated) {
        onToast(res.regenerated ? "已按 JTL Dashboard 版式更新 PDF 并打开" : "已生成 PDF，并在新窗口打开");
      } else {
        onToast("已在新窗口打开 PDF");
      }
    } catch (e) {
      onToast(e instanceof Error ? e.message : "打开 PDF 失败");
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

  const onExportRowJmx = async (file: string) => {
    if (!project || rowJmxExporting) return;
    setRowJmxExporting(file);
    try {
      const docs = await window.atp.loadPerfReports(project, [file]);
      const report = docs[0];
      if (!report) {
        onToast("无法读取该记录");
        return;
      }
      const resolved = await resolvePerfReportJmxXml(project, report);
      if ("error" in resolved) {
        onToast(resolved.error);
        return;
      }
      const res = await window.atp.saveTextWithDialog({
        defaultPath: resolved.suggestedName,
        content: resolved.xml.endsWith("\n") ? resolved.xml : `${resolved.xml}\n`,
        filters: [{ name: "JMeter 测试计划", extensions: ["jmx"] }],
      });
      if (res.cancelled) return;
      if (res.filePath) {
        onToast(
          resolved.rebuilt
            ? `已另存为 JMX（按历史记录重建）：${res.filePath}`
            : `已导出 JMX：${res.filePath}`,
        );
      } else onToast(res.error ?? "导出失败");
    } finally {
      setRowJmxExporting(null);
    }
  };

  const onOpenRowSummary = async (file: string) => {
    if (!project) return;
    const docs = await window.atp.loadPerfReports(project, [file]);
    const report = docs[0];
    if (!report) {
      onToast("无法读取该记录");
      return;
    }
    const label =
      report.request.name?.trim() ||
      `${report.request.method} ${report.request.url}`.slice(0, 80);
    const started = formatPerfStartedAtLocal(report.startedAt);
    setSummaryDialog({
      title: `压测摘要 · ${started} · ${label}`,
      text: formatPerfSummary(report),
      fileName: perfSummaryFileName(report),
      report,
    });
  };

  const onOpenArchiveDir = async () => {
    if (!project) return;
    const dir = await window.atp.getPerfReportsDir(project);
    const err = await window.atp.openPath(dir.absolute);
    if (err) onToast(err);
  };

  const onDeleteSelected = () => {
    if (!project) return;
    if (!resolvedFileSet.size) {
      onToast("请先勾选要删除的记录");
      return;
    }
    setConfirmDeleteOpen(true);
  };

  const runDeleteSelected = async () => {
    if (!project) return;
    const files = [...resolvedFileSet];
    setConfirmDeleteOpen(false);
    if (!files.length) return;
    setDeleting(true);
    try {
      const res = await window.atp.deletePerfReports(project, files);
      if (res.deleted > 0) {
        onToast(res.error ?? `已删除 ${res.deleted} 条记录`);
        clearSelection();
        await reload();
      } else onToast(res.error ?? "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  if (!project) return null;

  const selectionCount = combinedReports.length;
  const historyEmpty = !loading && history.length === 0;
  const hasHistory = history.length > 0;
  const hasBulkSelection = selectionCount > 0 || includeCurrent;
  const allRunsSelected =
    history.length > 0 && groupMode === "runs" && history.every((h) => selectedFiles.has(h.file));

  return (
    <div className="loadtest-history-page">
      <section className="loadtest-merge-panel loadtest-history-panel" aria-labelledby="loadtest-history-list-title">
        <div className="loadtest-merge-control">
          <div className="loadtest-merge-control-start">
            <h4 id="loadtest-history-list-title" className="loadtest-merge-title loadtest-history-list-heading">
              记录列表
            </h4>
            <div
              className="loadtest-merge-tabs loadtest-history-segment"
              role="tablist"
              aria-label="选择方式"
            >
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
            {hasHistory && groupMode === "endpoints" ? (
              <>
                <button type="button" className="loadtest-history-tool-btn" onClick={selectAll}>
                  全选接口
                </button>
                {hasBulkSelection ? (
                  <button type="button" className="loadtest-history-tool-btn" onClick={clearSelection}>
                    清除
                  </button>
                ) : null}
                <span className="loadtest-merge-control-sep" aria-hidden />
              </>
            ) : null}
            {hasHistory && groupMode === "runs" && hasBulkSelection ? (
              <>
                <button type="button" className="loadtest-history-tool-btn" onClick={clearSelection}>
                  清除所选
                </button>
                <span className="loadtest-merge-control-sep" aria-hidden />
              </>
            ) : null}
            <button
              type="button"
              className="loadtest-history-tool-btn"
              disabled={loading}
              title="重新扫描 perf 目录与 JMX 下的 results.jtl"
              onClick={() => void reload()}
            >
              {loading ? "扫描中…" : "刷新"}
            </button>
            <button
              type="button"
              className="loadtest-history-tool-btn"
              onClick={() => void onOpenArchiveDir()}
            >
              打开存档目录
            </button>
            {hasHistory && hasBulkSelection ? (
              <>
                <button
                  type="button"
                  className="loadtest-history-tool-btn"
                  disabled={exporting || !selectionCount}
                  onClick={() => void onExportJson()}
                >
                  导出 JSON
                </button>
                <button
                  type="button"
                  className="loadtest-history-tool-btn loadtest-history-tool-btn--danger"
                  disabled={!resolvedFileSet.size || deleting}
                  onClick={() => void onDeleteSelected()}
                >
                  {deleting ? "删除中…" : "删除所选"}
                </button>
                <button
                  type="button"
                  className="loadtest-history-tool-btn loadtest-history-tool-btn--accent"
                  disabled={exporting || selectionCount === 0}
                  onClick={() => void onExportMerged()}
                >
                  {exporting
                    ? "生成 PDF…"
                    : selectionCount > 0
                      ? `合并导出 PDF (${selectionCount})`
                      : "合并导出 PDF"}
                </button>
              </>
            ) : null}
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
          historyEmpty ? (
            <div
              className="loadtest-merge-table-wrap loadtest-history-table-wrap loadtest-history-table-wrap--empty"
            >
              {loading ? <p className="hint loadtest-history-loading">加载历史记录…</p> : null}
              <div className="loadtest-history-empty" role="status">
                <span className="loadtest-history-empty-icon" aria-hidden>
                  📂
                </span>
                <p className="loadtest-history-empty-title">暂无压测历史记录</p>
                <p className="loadtest-history-empty-lede">
                  执行一次 JMX 或 HTTP 压测后，数据将自动归档在此。
                </p>
                <p className="loadtest-history-empty-project">
                  当前仅展示「
                  <strong>{projectDisplayName?.trim() || project || "当前项目"}</strong>
                  」的压测数据；其它项目的记录需先切换项目后查看。
                  {onFocusProjectSelect ? (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="loadtest-history-empty-project-link"
                        onClick={onFocusProjectSelect}
                      >
                        点击切换项目
                      </button>
                    </>
                  ) : null}
                </p>
                {onNavigateTab ? (
                  <div className="loadtest-history-empty-actions">
                    <button
                      type="button"
                      className="primary loadtest-history-empty-cta"
                      onClick={() => onNavigateTab("config")}
                    >
                      前往压测配置
                    </button>
                    <button
                      type="button"
                      className="loadtest-history-empty-cta-secondary"
                      onClick={() => onNavigateTab("jmeterRun")}
                    >
                      去执行 JMX
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="loadtest-merge-table-wrap loadtest-history-table-wrap">
              {loading ? <p className="hint loadtest-history-loading">加载历史记录…</p> : null}
              <table className="loadtest-merge-table loadtest-history-table">
                <colgroup>
                  <col className="loadtest-history-col-check" />
                  <col className="loadtest-history-col-time" />
                  <col className="loadtest-history-col-plan" />
                  <col className="loadtest-history-col-interface" />
                  <col className="loadtest-history-col-samples" />
                  <col className="loadtest-history-col-success" />
                  <col className="loadtest-history-col-fail" />
                  <col className="loadtest-history-col-rps" />
                  <col className="loadtest-history-col-export" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="loadtest-merge-check-col loadtest-history-check-col">
                      {history.length > 1 ? (
                        <button
                          type="button"
                          className="loadtest-history-select-all"
                          onClick={() => (allRunsSelected ? clearSelection() : selectAll())}
                          title={allRunsSelected ? "取消全选" : "全选本页记录"}
                        >
                          {allRunsSelected ? "取消" : "全选"}
                        </button>
                      ) : (
                        <span className="loadtest-history-check-placeholder" aria-hidden>
                          ·
                        </span>
                      )}
                    </th>
                    <th>时间</th>
                    <th>计划</th>
                    <th>接口</th>
                    <th className="num loadtest-history-stat-head" title="样本数">
                      样本
                    </th>
                    <th className="num loadtest-history-stat-head loadtest-history-stat-head--ok" title="成功数">
                      成功
                    </th>
                    <th className="num loadtest-history-stat-head loadtest-history-stat-head--fail" title="失败数">
                      失败
                    </th>
                    <th className="num loadtest-history-stat-head">吞吐</th>
                    <th className="loadtest-history-actions-col">导出</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => {
                    const planLabel = historyRowPlan(row);
                    const interfaceLabel = historyRowInterface(row, jtlEndpointsByFile);
                    const interfaceMethod = historyRowInterfaceMethod(row, jtlEndpointsByFile);
                    const methodClass = interfaceMethod.toLowerCase();
                    return (
                    <tr
                      key={row.file}
                      className={`loadtest-history-table-row${
                        selectedFiles.has(row.file) ? " loadtest-merge-row--selected" : ""
                      }`}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedFiles.has(row.file)}
                          onChange={() => toggleFile(row.file)}
                          aria-label={`选择 ${row.startedAt}`}
                        />
                      </td>
                      <td className="loadtest-merge-time loadtest-history-time">
                        <time dateTime={row.startedAt} title={formatPerfStartedAtLocal(row.startedAt)}>
                          {formatPerfStartedAtLocal(row.startedAt)}
                        </time>
                      </td>
                      <td className="loadtest-history-plan-cell" title={planLabel}>
                        <span className="loadtest-history-plan-text">{planLabel}</span>
                      </td>
                      <td
                        className="loadtest-history-interface-cell"
                        title={
                          jtlEndpointsForListRow(row, jtlEndpointsByFile)[0]?.url || row.url
                        }
                      >
                        <div className="loadtest-history-interface-line">
                          <span className={`method-tag method-${methodClass}`}>{interfaceMethod}</span>
                          <span className="loadtest-history-interface-text">{interfaceLabel}</span>
                        </div>
                      </td>
                      <td className="num loadtest-history-stat loadtest-history-stat-samples">{row.samples}</td>
                      <td className="num loadtest-history-stat loadtest-history-stat-ok">{row.success}</td>
                      <td
                        className={`num loadtest-history-stat loadtest-history-stat-fail${
                          row.failed > 0 ? " loadtest-history-fail--warn" : ""
                        }`}
                      >
                        {row.failed}
                      </td>
                      <td className="num loadtest-history-rps">{row.rps.toFixed(2)}/s</td>
                      <td>
                        <div className="loadtest-history-export-group" role="group" aria-label="导出">
                          <button
                            type="button"
                            className="loadtest-history-export-btn"
                            disabled={rowExporting === row.file || exporting}
                            title="在新窗口查看 PDF（支持缩放、搜索、打印）"
                            onClick={() => void onOpenRowPdf(row.file)}
                          >
                            <span className="loadtest-history-export-btn-icon" aria-hidden>
                              📄
                            </span>
                            {rowExporting === row.file ? "…" : "PDF"}
                          </button>
                          <button
                            type="button"
                            className="loadtest-history-export-btn"
                            disabled={rowJmxExporting === row.file}
                            title="导出 JMX"
                            onClick={() => void onExportRowJmx(row.file)}
                          >
                            <span className="loadtest-history-export-btn-icon" aria-hidden>
                              ⚙️
                            </span>
                            {rowJmxExporting === row.file ? "…" : "JMX"}
                          </button>
                          <button
                            type="button"
                            className="loadtest-history-export-btn"
                            title="查看摘要"
                            onClick={() => void onOpenRowSummary(row.file)}
                          >
                            <span className="loadtest-history-export-btn-icon" aria-hidden>
                              📝
                            </span>
                            摘要
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <ul className="loadtest-merge-endpoints">
            {endpointGroups.map((group) => (
              <li
                key={group.key}
                className={selectedEndpoints.has(group.key) ? "loadtest-merge-endpoint-item--selected" : ""}
              >
                <label className="loadtest-merge-endpoint-item">
                  <input
                    type="checkbox"
                    checked={selectedEndpoints.has(group.key)}
                    onChange={() => toggleEndpoint(group.key)}
                  />
                  <span
                    className="loadtest-merge-endpoint-label"
                    title={`${group.ep.label} · ${group.ep.url}`}
                  >
                    <span className={`method-tag method-${group.ep.method.toLowerCase()}`}>
                      {group.ep.method}
                    </span>
                    <span className="loadtest-merge-endpoint-text">{formatJtlEndpointLine(group.ep)}</span>
                  </span>
                  <span className="hint loadtest-merge-endpoint-meta">{group.runs.length} 次执行</span>
                </label>
              </li>
            ))}
            {!endpointGroups.length && !loading ? <li className="hint">暂无历史接口记录</li> : null}
          </ul>
        )}

        {combinedReports.length > 0 ? (
          <div
            className={`loadtest-merge-preview loadtest-history-preview${
              previewExpanded ? " loadtest-history-preview--open" : ""
            }`}
          >
            <div className="loadtest-history-preview-bar">
              <button
                type="button"
                className="loadtest-history-preview-toggle"
                aria-expanded={previewExpanded}
                onClick={() => setPreviewExpanded((v) => !v)}
              >
                <span className="loadtest-history-preview-toggle-label">
                  合并预览
                  <span className="loadtest-history-preview-toggle-count">{combinedReports.length}</span>
                </span>
                <span className="loadtest-history-preview-chevron" aria-hidden>
                  {previewExpanded ? "▾" : "▸"}
                </span>
              </button>
              {!previewExpanded && mergedStats ? (
                <div className="loadtest-history-preview-mini">
                  <span>{mergedStats.samples} 样本</span>
                  <span>{uniqueEndpointCount(combinedReports)} 接口</span>
                  <span>{mergedStats.rps} req/s</span>
                </div>
              ) : null}
            </div>
            {previewExpanded ? (
              <>
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
              </>
            ) : null}
          </div>
        ) : hasHistory && history.length > 1 ? (
          <p className="hint loadtest-merge-hint">勾选多条记录后可展开合并预览，或使用工具栏合并导出。</p>
        ) : null}
      </section>

      <PerfSummaryDialog
        open={Boolean(summaryDialog)}
        title={summaryDialog?.title ?? "压测摘要"}
        text={summaryDialog?.text ?? ""}
        report={summaryDialog?.report}
        defaultFileName={summaryDialog?.fileName ?? "perf-summary.txt"}
        onClose={() => setSummaryDialog(null)}
        onToast={onToast}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="删除压测记录"
        message={`确定删除所选 ${resolvedFileSet.size} 条压测记录？将同时删除同目录下同名 PDF（若有），且不可恢复。`}
        confirmLabel={deleting ? "删除中…" : "删除"}
        danger
        onConfirm={() => void runDeleteSelected()}
        onCancel={() => {
          if (!deleting) setConfirmDeleteOpen(false);
        }}
      />
    </div>
  );
}

function historyRowPlan(row: PerfListItem): string {
  const method = row.method.toUpperCase();
  if (method === "JMX") {
    const name = row.name?.trim() ?? "";
    return name.replace(/^JMeter\s*[·•]\s*/i, "") || "JMeter 执行";
  }
  return row.name?.trim() || "—";
}

function jtlEndpointsForListRow(
  row: PerfListItem,
  cache: Record<string, HttpBenchmarkJtlEndpoint[]>,
): HttpBenchmarkJtlEndpoint[] {
  if (row.method.toUpperCase() !== "JMX") return [];
  if (row.jtlEndpoints?.length) return row.jtlEndpoints;
  return cache[row.file] ?? [];
}

function historyRowInterfaceMethod(row: PerfListItem, cache: Record<string, HttpBenchmarkJtlEndpoint[]>): string {
  const eps = jtlEndpointsForListRow(row, cache);
  if (eps.length) return eps[0].method;
  return row.method;
}

function historyRowInterface(row: PerfListItem, cache: Record<string, HttpBenchmarkJtlEndpoint[]>): string {
  const method = row.method.toUpperCase();
  if (method === "JMX") {
    const eps = jtlEndpointsForListRow(row, cache);
    if (eps.length) {
      const primary = formatJtlEndpointLine(eps[0]);
      return eps.length === 1 ? primary : `${primary} 等 ${eps.length} 个接口`;
    }
    return "正在从 JTL 解析接口…";
  }
  const raw = row.url.trim();
  if (!raw) return "—";
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const short = `${u.host}${u.pathname}${u.search}` || raw;
    return short.length > 80 ? `${short.slice(0, 77)}…` : short;
  } catch {
    return raw.length > 80 ? `${raw.slice(0, 77)}…` : raw;
  }
}

function uniqueEndpointCount(reports: HttpBenchmarkReport[]): number {
  return new Set(reports.map(endpointKey)).size;
}
