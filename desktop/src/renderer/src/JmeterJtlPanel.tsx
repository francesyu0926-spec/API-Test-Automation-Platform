import { useEffect, useMemo, useRef, useState } from "react";

import type { JtlSample } from "../../shared/jtl";
import type { JtlStreamAggregateResult } from "../../shared/jtlStreamAggregator";
import { resolveJtlModeForFileSize, type JtlStreamModeId } from "../../shared/jtlStreamModes";
import { LatencyDistributionChart, StatusCodeChart } from "./benchmarkCharts";
import {
  buildJmeterApdex,
  buildJmeterStatistics,
  buildJmeterErrors,
  buildJmeterTestInfo,
  buildJmeterTestInfoFromRange,
  buildTop5ErrorsBySampler,
} from "../../shared/jmeterStatistics";
import JmeterDashboardView from "./JmeterDashboardView";
import {
  jtlHttpSamples,
  summarizeJtlFile,
  uniqueJtlEndpoints,
} from "./jtlAnalytics";
import { buildJmxFromWorkbenchDrafts, type JmxExportOptions } from "./jmxExport";
import { buildJmeterDashboardPdfHtml } from "./jmeterDashboardPdf";
import { latencyBins } from "./perfHistogram";
import { previewDashboardPdf } from "./pdfPreviewClient";
import JtlSampleVirtualTable from "./JtlSampleVirtualTable";
import HeavyJtlLoadOverlay from "./HeavyJtlLoadOverlay";

type Props = {
  project: string;
  envName: string;
  onToast: (msg: string) => void;
  /** 执行 JMX 完成后自动填入并加载 */
  initialJtlPath?: string;
  jtlStreamMode?: JtlStreamModeId;
};

export default function JmeterJtlPanel({
  project,
  envName,
  onToast,
  initialJtlPath,
  jtlStreamMode = "fast",
}: Props) {
  const [filePath, setFilePath] = useState(initialJtlPath ?? "");
  const [samples, setSamples] = useState<JtlSample[] | null>(null);
  const [streamAgg, setStreamAgg] = useState<JtlStreamAggregateResult | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [parseRows, setParseRows] = useState(0);
  const [jtlSizeBytes, setJtlSizeBytes] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [jmxBusy, setJmxBusy] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const [dropActive, setDropActive] = useState(false);
  const [reportTab, setReportTab] = useState<"overview" | "stats" | "errors" | "charts">("overview");
  const loaded = Boolean(streamAgg?.totalRows || samples?.length);

  const summary = useMemo(() => {
    if (streamAgg?.totalRows) {
      return {
        totalRows: streamAgg.totalRows,
        httpSamples: streamAgg.httpSampleCount,
        skippedWs: streamAgg.totalRows - streamAgg.httpSampleCount,
        labels: streamAgg.statistics.filter((r) => r.transaction !== "Total").length,
        threadPeak: streamAgg.threadPeak,
        startedAt: streamAgg.startedAt,
        endedAt: streamAgg.endedAt,
        wallMs: streamAgg.wallMs,
      };
    }
    return samples ? summarizeJtlFile(samples) : null;
  }, [samples, streamAgg]);
  const sourceName = filePath.replace(/^.*[\\/]/, "") || "results.jtl";
  const dashboard = useMemo(() => {
    if (streamAgg?.totalRows) {
      const startMs = new Date(streamAgg.startedAt).getTime();
      const endMs = new Date(streamAgg.endedAt).getTime();
      return {
        testInfo: buildJmeterTestInfoFromRange(startMs, endMs, sourceName),
        apdex: streamAgg.apdex,
        statistics: streamAgg.statistics,
        errors: streamAgg.errorsSummary,
        top5BySampler: streamAgg.top5BySampler,
      };
    }
    if (!samples?.length) return null;
    return {
      testInfo: buildJmeterTestInfo(samples, sourceName),
      apdex: buildJmeterApdex(samples),
      statistics: buildJmeterStatistics(samples),
      errors: buildJmeterErrors(samples),
      top5BySampler: buildTop5ErrorsBySampler(samples),
    };
  }, [samples, sourceName, streamAgg]);

  const loadFromPath = async (path: string): Promise<JtlSample[] | null> => {
    const p = path.trim();
    if (!p) {
      onToast("请选择或填写 JTL 文件路径");
      return null;
    }
    setLoading(true);
    setParseRows(0);
    const unsubProgress = window.atp.onJtlParseProgress?.((ev) => setParseRows(ev.rows));
    try {
      const size = await window.atp.statAbsoluteFile(p);
      setJtlSizeBytes(size ?? null);
      const { mode: modeForLoad, forcedFast } = resolveJtlModeForFileSize(size, jtlStreamMode);
      if (forcedFast) {
        onToast(
          "检测到超大 JTL 文件，已自动使用「极速模式」预览，您可手动切换至「深度模式」以获取更高精度。",
        );
      }
      const agg = await window.atp.aggregateJtlFile(p, modeForLoad);
      setStreamAgg(agg);
      setParseErrors(agg.errors);
      setSamples(agg.samples);
      setFilePath(p);
      if (!agg.totalRows) {
        onToast(agg.errors[0] ?? "JTL 无有效数据");
        return null;
      }
      const httpN = agg.httpSampleCount;
      const preview = agg.samples.length;
      const streamNote =
        agg.totalRows > preview ? `（流式解析共 ${agg.totalRows} 条，预览 ${preview} 条）` : "";
      onToast(`已加载 ${agg.totalRows} 条样本（HTTP ${httpN}）${streamNote}`);
      return agg.samples;
    } finally {
      unsubProgress?.();
      setLoading(false);
      setParseRows(0);
    }
  };

  const parseRowEstimate =
    jtlSizeBytes && jtlSizeBytes > 0 ? Math.max(parseRows, Math.round(jtlSizeBytes / 180)) : null;

  useEffect(() => {
    if (!initialJtlPath?.trim()) return;
    void loadFromPath(initialJtlPath);
  }, [initialJtlPath]);

  useEffect(() => {
    if (!filePath.trim() || loading) return;
    void loadFromPath(filePath);
    // 切换解析模式时用当前 JTL 路径重新聚合
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jtlStreamMode only
  }, [jtlStreamMode]);

  const onBrowse = async () => {
    const picked = await window.atp.pickOpenFile({
      defaultPath: filePath.trim() || undefined,
      filters: [{ name: "JMeter 结果 (JTL)", extensions: ["jtl", "csv", "txt"] }],
    });
    if (picked.cancelled || !picked.filePath) return;
    setFilePath(picked.filePath);
  };

  const pathFromDrop = (file: File | undefined): string | null => {
    if (!file) return null;
    const withPath = file as File & { path?: string };
    if (withPath.path?.trim()) return withPath.path.trim();
    if (/\.(jtl|csv|txt)$/i.test(file.name)) return null;
    onToast("请拖拽 .jtl 文件");
    return null;
  };

  const onDropJtl = async (ev: React.DragEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    setDropActive(false);
    const path = pathFromDrop(ev.dataTransfer.files[0]);
    if (!path) return;
    setFilePath(path);
  };

  const onOpenContainingFolder = async () => {
    const p = filePath.trim();
    if (!p) return;
    const dir = p.replace(/[\\/][^\\/]+$/, "");
    if (!dir) return;
    const err = await window.atp.openPath(dir);
    if (err) onToast(err);
  };

  const resolveSamples = async (): Promise<JtlSample[] | null> => {
    if (samples?.length) return samples;
    if (!filePath.trim()) {
      onToast("请先填写 JTL 路径并点击「加载」，或直接点「生成 JMX」将自动读取");
      return null;
    }
    onToast("正在读取 JTL…");
    return loadFromPath(filePath);
  };

  const onExportJmx = async () => {
    if (!project) {
      onToast("请先选择项目");
      return;
    }
    setJmxBusy(true);
    try {
      const data = await resolveSamples();
      if (!data?.length) return;

      const endpoints = uniqueJtlEndpoints(data);
      if (!endpoints.length) {
        onToast("没有可导出的 HTTP 接口（已跳过 WebSocket 等）");
        return;
      }
      const variables = await window.atp.getProjectVariables(project, envName);
      const baseName = filePath.replace(/^.*[\\/]/, "").replace(/\.jtl$/i, "") || "jtl-import";
      const fileSummary = summarizeJtlFile(data);
      const opts: JmxExportOptions = {
        planName: `JTL 导入 · ${baseName}`,
        threadGroupName: "行情 HTTP 接口",
        threads: Math.min(50, Math.max(1, fileSummary.threadPeak)),
        rampUpSec: 1,
        loops: 1,
        envName,
        injectEnv: true,
      };
      const built = buildJmxFromWorkbenchDrafts(
        endpoints.map((e) => ({ label: e.label, draft: e.draft })),
        opts,
        variables,
      );
      if (built.errors.length) {
        onToast(built.errors.slice(0, 2).join("；"));
      }
      if (!built.xml) {
        onToast("生成 JMX 失败，请查看上方错误提示");
        return;
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const repoPath = `projects/${project}/jmx/${baseName}-${stamp}.jmx`;
      const jtlDir = filePath.replace(/^(.*)[\\/][^\\/]+$/, "$1").trim();
      const suggestedJmxName = `${baseName}-${stamp}.jmx`;
      const saveDefaultPath = jtlDir ? `${jtlDir}\\${suggestedJmxName}` : suggestedJmxName;

      const saveDialog = await window.atp.saveTextWithDialog({
        defaultPath: saveDefaultPath,
        content: built.xml,
        filters: [{ name: "JMeter 测试计划", extensions: ["jmx"] }],
      });
      if (saveDialog.ok && saveDialog.filePath) {
        onToast(`JMX 已保存：${saveDialog.filePath}`);
      } else if (saveDialog.cancelled) {
        onToast("已取消另存为；仍将写入项目 jmx 目录");
      } else if (saveDialog.error) {
        onToast(`另存为失败：${saveDialog.error}`);
      }

      const repo = await window.atp.writeRepoFile(repoPath, built.xml);
      if (repo.ok) {
        onToast(`已写入项目：${repo.relativePath}`);
      } else {
        onToast(repo.error ?? "写入项目 jmx 失败");
      }
      if (built.warnings.length) {
        onToast(built.warnings[0]!);
      }
    } catch (e) {
      onToast(e instanceof Error ? e.message : "生成 JMX 失败");
    } finally {
      setJmxBusy(false);
    }
  };

  const buildDashboardPdfHtmlFromState = async (): Promise<string | null> => {
    const pdfLatencyFrom = (elapsed: number[]) =>
      elapsed.length
        ? latencyBins(elapsed, 50).map((b) => ({ label: b.label, count: b.count }))
        : undefined;

  if (dashboard) {
      const elapsed = samples?.map((s) => s.elapsed) ?? [];
      return buildJmeterDashboardPdfHtml({
        testInfo: dashboard.testInfo,
        apdex: dashboard.apdex,
        statistics: dashboard.statistics,
        errors: dashboard.errors,
        top5BySampler: dashboard.top5BySampler,
        environment: envName.trim() || undefined,
        projectName: project,
        latencyBins: pdfLatencyFrom(elapsed),
      });
    }
    const data = await resolveSamples();
    if (!data?.length) return null;
    const srcName = filePath.replace(/^.*[\\/]/, "") || "results.jtl";
    return buildJmeterDashboardPdfHtml({
      testInfo: buildJmeterTestInfo(data, srcName),
      apdex: buildJmeterApdex(data),
      statistics: buildJmeterStatistics(data),
      errors: buildJmeterErrors(data),
      top5BySampler: buildTop5ErrorsBySampler(data),
      environment: envName.trim() || undefined,
      projectName: project,
      latencyBins: pdfLatencyFrom(data.map((s) => s.elapsed)),
    });
  };

  const suggestedDashboardPdfName = () => {
    const baseName = filePath.replace(/^.*[\\/]/, "").replace(/\.jtl$/i, "") || "jmeter-jtl";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `jtl-report-${baseName}-${stamp}`;
  };

  const onPreviewPdf = async () => {
    setExporting(true);
    try {
      const html = await buildDashboardPdfHtmlFromState();
      if (!html) return;
      const res = await previewDashboardPdf(html, suggestedDashboardPdfName(), project);
      if (res.ok) {
        onToast("已打开 PDF 预览：可用内置工具栏或菜单进行缩放、翻页、打印、另存为（Ctrl+S）");
      } else {
        onToast(res.error ?? "预览失败");
      }
    } catch (e) {
      onToast(e instanceof Error ? e.message : "预览 PDF 失败");
    } finally {
      setExporting(false);
    }
  };

  const onExportPdf = async () => {
    if (!project) {
      onToast("请先选择项目");
      return;
    }
    setExporting(true);
    try {
      const html = await buildDashboardPdfHtmlFromState();
      if (!html) return;
      const res = await window.atp.exportPerfReportPdfDialog(
        project,
        html,
        suggestedDashboardPdfName(),
      );
      if (res.cancelled) onToast("已取消另存为");
      else if (res.pdfFilePath) onToast(`压测报告已保存：${res.pdfFilePath}`);
      else onToast(res.error ?? "导出失败");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "导出 PDF 失败");
    } finally {
      setExporting(false);
    }
  };

  const statusCodes = useMemo(() => {
    if (!samples) return {};
    const out: Record<string, number> = {};
    for (const s of samples) {
      const code = s.responseCode || "0";
      out[code] = (out[code] ?? 0) + 1;
    }
    return out;
  }, [samples]);

  const durations = useMemo(() => (samples ? samples.map((s) => s.elapsed) : []), [samples]);

  const canExport = loaded && !loading;

  const statusLabel = loading ? "解析中" : loaded ? "已就绪" : "待解析";
  const statusClass = loading
    ? "loadtest-jtl-pill--busy"
    : loaded
      ? "loadtest-jtl-pill--ok"
      : "loadtest-jtl-pill--idle";

  const pathInputRow = (compact: boolean, inCard = false) => {
    const showOpenDir = compact && loaded && Boolean(filePath.trim());
    return (
      <div
        className={`loadtest-jtl-path-bar${compact ? " loadtest-jtl-path-bar--compact" : ""}${
          inCard ? " loadtest-jtl-path-bar--in-card" : ""
        }`}
      >
        <div className="jmeter-input-group loadtest-jtl-input-group">
          <input
            className="text-input jmeter-input-group-control loadtest-jtl-path"
            value={filePath}
            placeholder="选择或粘贴 JTL 文件路径。"
            spellCheck={false}
            disabled={loading}
            onChange={(e) => setFilePath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && filePath.trim()) void loadFromPath(filePath);
            }}
          />
          <button
            type="button"
            className="jmeter-input-group-btn loadtest-jtl-browse-btn"
            title="浏览 JTL 文件"
            aria-label="浏览"
            disabled={loading}
            onClick={() => void onBrowse()}
          >
            <JtlFolderIcon />
          </button>
        </div>
        <button
          type="button"
          className="primary loadtest-jtl-parse-btn"
          disabled={loading || !filePath.trim()}
          onClick={() => void loadFromPath(filePath)}
        >
          {loading ? "解析中…" : "加载并解析"}
        </button>
        {showOpenDir ? (
          <button
            type="button"
            className="nav-btn nav-btn--compact nav-btn--ghost loadtest-jtl-open-dir"
            title="在资源管理器中打开 JTL 所在文件夹"
            onClick={() => void onOpenContainingFolder()}
          >
            打开所在目录
          </button>
        ) : null}
      </div>
    );
  };

  const showDropPane = !loaded && !filePath.trim();

  return (
    <div className={`loadtest-jtl-shell${loaded ? " loadtest-jtl-shell--ready" : ""}`}>
      <HeavyJtlLoadOverlay
        show={loading}
        parsedRows={parseRows}
        estimatedTotal={parseRowEstimate}
        logTail={
          parseRows > 0
            ? `流式读取中 · 第 ${parseRows.toLocaleString("zh-CN")} 行…`
            : "正在打开文件…"
        }
      />
      <header className="loadtest-jtl-head">
        <div className="loadtest-jtl-head-copy">
          <h3 className="loadtest-jtl-title">JTL 结果分析</h3>
          <p className="hint loadtest-jtl-lede">
            加载 <code>results.jtl</code>，查看与 JMeter Dashboard 对齐的概览、图表与明细。
          </p>
        </div>
        <div className="loadtest-jtl-head-end">
          {loaded ? (
            <div className="loadtest-jtl-head-actions">
              <button
                type="button"
                className="nav-btn nav-btn--accent nav-btn--compact"
                disabled={!canExport || jmxBusy}
                onClick={() => void onExportJmx()}
              >
                {jmxBusy ? "正在生成…" : "生成 JMX"}
              </button>
              <button
                type="button"
                className="nav-btn nav-btn--compact nav-btn--accent"
                disabled={!canExport || exporting}
                title="在新窗口预览 PDF，支持缩放、翻页、打印与另存为"
                onClick={() => void onPreviewPdf()}
              >
                {exporting ? "生成中…" : "预览 PDF"}
              </button>
              <button
                type="button"
                className="nav-btn nav-btn--compact"
                disabled={!canExport || exporting || !project}
                title="直接选择路径保存 PDF 文件"
                onClick={() => void onExportPdf()}
              >
                另存为 PDF
              </button>
            </div>
          ) : null}
          <span className={`loadtest-jtl-pill ${statusClass}`} aria-live="polite">
            <span
              className={`loadtest-jtl-status-dot${
                loading ? " loadtest-jtl-status-dot--pulse" : ""
              }`}
              aria-hidden
            />
            {statusLabel}
            {loaded && summary ? (
              <span className="loadtest-jtl-pill-meta"> · {summary.totalRows} 样本</span>
            ) : null}
          </span>
        </div>
      </header>

      {!loaded ? (
        <section className="loadtest-jtl-picker-card" aria-labelledby="jtl-import-heading">
          <h4 id="jtl-import-heading" className="visually-hidden">
            导入 JTL
          </h4>
          {showDropPane ? (
            <div
              className={`loadtest-jtl-dropzone loadtest-jtl-dropzone--solo${
                dropActive ? " loadtest-jtl-dropzone--active" : ""
              }${loading ? " loadtest-jtl-dropzone--busy" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (!loading) void onBrowse();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (!loading) void onBrowse();
                }
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                setDropActive(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDropActive(true);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setDropActive(false);
              }}
              onDrop={(e) => void onDropJtl(e)}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text").trim();
                if (!text) return;
                e.preventDefault();
                setFilePath(text);
              }}
            >
              <JtlDocIcon className="loadtest-jtl-dropzone-icon-svg" />
              <p className="loadtest-jtl-dropzone-title">
                {loading ? "正在解析 JTL…" : "拖拽文件至此，或点击浏览"}
              </p>
              <p className="hint loadtest-jtl-dropzone-hint">支持 JMeter JTL 与 CSV 结果文件</p>
            </div>
          ) : (
            pathInputRow(false, true)
          )}
        </section>
      ) : (
        <section className="loadtest-jtl-toolbar" aria-label="JTL 源文件">
          {pathInputRow(true)}
        </section>
      )}

      {parseErrors.length ? (
        <p className="loadtest-jtl-warn" role="status">
          {parseErrors.join(" ")}
        </p>
      ) : null}

      {summary && loaded ? (
        <div className="loadtest-jtl-kpi-row" role="status">
          <div className="loadtest-jtl-kpi">
            <span className="loadtest-jtl-kpi-label">样本</span>
            <strong>{summary.totalRows}</strong>
          </div>
          <div className="loadtest-jtl-kpi">
            <span className="loadtest-jtl-kpi-label">HTTP</span>
            <strong>{summary.httpSamples}</strong>
          </div>
          <div className="loadtest-jtl-kpi">
            <span className="loadtest-jtl-kpi-label">标签</span>
            <strong>{summary.labels}</strong>
          </div>
          <div className="loadtest-jtl-kpi">
            <span className="loadtest-jtl-kpi-label">时长</span>
            <strong>{(summary.wallMs / 1000).toFixed(2)}s</strong>
          </div>
          {dashboard ? (
            <>
              <div className="loadtest-jtl-kpi loadtest-jtl-kpi--time" title={dashboard.testInfo.startTime}>
                <span className="loadtest-jtl-kpi-label">开始</span>
                <strong>{dashboard.testInfo.startTime}</strong>
              </div>
              <div className="loadtest-jtl-kpi loadtest-jtl-kpi--time" title={dashboard.testInfo.endTime}>
                <span className="loadtest-jtl-kpi-label">结束</span>
                <strong>{dashboard.testInfo.endTime}</strong>
              </div>
            </>
          ) : null}
          {filePath.trim() ? (
            <div className="loadtest-jtl-kpi loadtest-jtl-kpi--file" title={filePath}>
              <span className="loadtest-jtl-kpi-label">文件</span>
              <strong>{sourceName}</strong>
            </div>
          ) : null}
          {summary.skippedWs > 0 ? (
            <div className="loadtest-jtl-kpi loadtest-jtl-kpi--muted">
              <span className="loadtest-jtl-kpi-label">WebSocket</span>
              <strong>已忽略 {summary.skippedWs}</strong>
            </div>
          ) : null}
        </div>
      ) : null}

      {dashboard ? (
        <div className="loadtest-jtl-results">
          <div className="loadtest-jtl-report-tabs" role="tablist" aria-label="报告分区">
            {(
              [
                ["overview", "概览"],
                ["stats", "统计"],
                ["errors", "错误"],
                ["charts", "图表"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={reportTab === id}
                className={`loadtest-jtl-report-tab${reportTab === id ? " is-active" : ""}`}
                onClick={() => setReportTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <JmeterDashboardView
            visibleSection={reportTab}
            testInfo={dashboard.testInfo}
            apdex={dashboard.apdex}
            statistics={dashboard.statistics}
            errors={dashboard.errors}
            top5BySampler={dashboard.top5BySampler}
            percentileMeta={streamAgg?.percentileMeta}
            onToast={onToast}
          />
          {reportTab === "stats" && samples && samples.length > 0 ? (
            <JtlSampleVirtualTable rows={samples} totalRows={summary?.totalRows} />
          ) : null}
          {reportTab === "charts" ? (
            <div ref={previewRef} className="grid-2 perf-charts-grid loadtest-jtl-charts">
              <div className="perf-chart-panel">
                <h4 className="sub-title">Response Times（分布）</h4>
                <LatencyDistributionChart durationsMs={durations} bucketMs={50} />
              </div>
              <div className="perf-chart-panel">
                <h4 className="sub-title">状态码</h4>
                <StatusCodeChart statusCodes={statusCodes} />
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        !loading && (
          <div className="loadtest-jtl-placeholder" role="status">
            <p className="loadtest-jtl-placeholder-title">暂无 Dashboard 数据</p>
            <p className="hint">选择 JTL 并点击「加载并解析」，或从「执行 JMX」运行结束后自动跳转本页。</p>
          </div>
        )
      )}
    </div>
  );
}

function JtlFolderIcon() {
  return (
    <svg className="loadtest-jtl-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M1.75 3.5A1.25 1.25 0 0 1 3 2.25h3.086a1.25 1.25 0 0 1 .884.366L7.75 3.5h5.25A1.25 1.25 0 0 1 14.25 4.75v7.5A1.25 1.25 0 0 1 13 13.25H3A1.25 1.25 0 0 1 1.75 12V3.5Zm1.25-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h10c.138 0 .25-.112.25-.25v-7.5a.25.25 0 0 0-.25-.25H7.31l-1.23-1.23A.25.25 0 0 0 5.586 3.25H3a.25.25 0 0 0-.25.25Z"
      />
    </svg>
  );
}

function JtlDocIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? "loadtest-jtl-icon"} viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="currentColor"
        fillOpacity="0.88"
        d="M12 6a4 4 0 0 0-4 4v28a4 4 0 0 0 4 4h24a4 4 0 0 0 4-4V18l-12-12H12Zm16 2.83V16a4 4 0 0 0 4 4h7.17L28 8.83ZM14 26h20a2 2 0 1 1 0 4H14a2 2 0 0 1 0-4Zm0 8h14a2 2 0 1 1 0 4H14a2 2 0 0 1 0-4Z"
      />
    </svg>
  );
}