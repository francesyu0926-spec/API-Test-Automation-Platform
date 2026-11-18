import { useEffect, useMemo, useRef, useState } from "react";

import type { JtlSample } from "../../shared/jtl";
import { parseJtlCsv } from "../../shared/jtl";
import { LatencyDistributionChart, StatusCodeChart } from "./benchmarkCharts";
import {
  buildJmeterApdex,
  buildJmeterStatistics,
  buildJmeterErrors,
  buildJmeterTestInfo,
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

type Props = {
  project: string;
  envName: string;
  onToast: (msg: string) => void;
  /** 执行 JMX 完成后自动填入并加载 */
  initialJtlPath?: string;
};

export default function JmeterJtlPanel({ project, envName, onToast, initialJtlPath }: Props) {
  const [filePath, setFilePath] = useState(initialJtlPath ?? "");
  const [samples, setSamples] = useState<JtlSample[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [jmxBusy, setJmxBusy] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const loaded = Boolean(samples?.length);

  const summary = useMemo(() => (samples ? summarizeJtlFile(samples) : null), [samples]);
  const sourceName = filePath.replace(/^.*[\\/]/, "") || "results.jtl";
  const dashboard = useMemo(() => {
    if (!samples?.length) return null;
    return {
      testInfo: buildJmeterTestInfo(samples, sourceName),
      apdex: buildJmeterApdex(samples),
      statistics: buildJmeterStatistics(samples),
      errors: buildJmeterErrors(samples),
      top5BySampler: buildTop5ErrorsBySampler(samples),
    };
  }, [samples, sourceName]);

  const loadFromPath = async (path: string): Promise<JtlSample[] | null> => {
    const p = path.trim();
    if (!p) {
      onToast("请选择或填写 JTL 文件路径");
      return null;
    }
    setLoading(true);
    try {
      const text = await window.atp.readAbsoluteFile(p);
      if (text == null) {
        onToast("无法读取文件，请确认路径正确且应用有读取权限");
        return null;
      }
      const parsed = parseJtlCsv(text);
      setParseErrors(parsed.errors);
      setSamples(parsed.samples);
      setFilePath(p);
      if (!parsed.samples.length) {
        onToast(parsed.errors[0] ?? "JTL 无有效数据");
        return null;
      }
      onToast(`已加载 ${parsed.samples.length} 条样本（HTTP ${jtlHttpSamples(parsed.samples).length}）`);
      return parsed.samples;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialJtlPath?.trim()) return;
    void loadFromPath(initialJtlPath);
  }, [initialJtlPath]);

  const onBrowse = async () => {
    const picked = await window.atp.pickOpenFile({
      defaultPath: filePath.trim() || undefined,
      filters: [{ name: "JMeter 结果 (JTL)", extensions: ["jtl", "csv", "txt"] }],
    });
    if (picked.cancelled || !picked.filePath) return;
    setFilePath(picked.filePath);
    await loadFromPath(picked.filePath);
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

      const saveDialog = await window.atp.saveTextWithDialog({
        defaultPath: `${baseName}.jmx`,
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

  const onExportPdf = async () => {
    if (!project) {
      onToast("请先选择项目");
      return;
    }
    setExporting(true);
    try {
      const data = await resolveSamples();
      if (!data?.length) return;
      const srcName = filePath.replace(/^.*[\\/]/, "") || "results.jtl";
      const testInfo = buildJmeterTestInfo(data, srcName);
      const statistics = buildJmeterStatistics(data);
      const apdex = buildJmeterApdex(data);
      const errors = buildJmeterErrors(data);
      const top5BySampler = buildTop5ErrorsBySampler(data);
      const html = buildJmeterDashboardPdfHtml({
        testInfo,
        apdex,
        statistics,
        errors,
        top5BySampler,
      });
      const baseName = filePath.replace(/^.*[\\/]/, "").replace(/\.jtl$/i, "") || "jmeter-jtl";
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const res = await window.atp.exportPerfReportPdfDialog(
        project,
        html,
        `jtl-report-${baseName}-${stamp}`,
      );
      if (res.cancelled) onToast("已取消导出 PDF");
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

  const canAct = Boolean(filePath.trim()) && !loading;

  return (
    <div className="loadtest-jtl-shell">
      <header className="loadtest-jtl-head">
        <div className="loadtest-jtl-head-copy">
          <h3 className="loadtest-jtl-title">JTL 结果分析</h3>
          <p className="hint loadtest-jtl-lede">
            解析 <code>results.jtl</code>，展示与 JMeter HTML Dashboard 对齐的统计；支持导出 PDF 或反向生成 HTTP{" "}
            <code>.jmx</code>。
          </p>
        </div>
        <div className="loadtest-jtl-status" aria-live="polite">
          {loading ? <span className="hint">读取中…</span> : null}
          {!loading && loaded && summary ? (
            <span className="loadtest-jtl-pill loadtest-jtl-pill--ok">
              已加载 · {summary.totalRows} 样本
            </span>
          ) : null}
          {!loading && !loaded ? <span className="loadtest-jtl-pill loadtest-jtl-pill--idle">未加载</span> : null}
        </div>
      </header>

      <div className="loadtest-jtl-grid">
        <section className="loadtest-jtl-block" aria-labelledby="jtl-file-heading">
          <h4 id="jtl-file-heading" className="loadtest-jtl-block-title">
            结果文件
          </h4>
          <label className="loadtest-field loadtest-jtl-field">
            <span className="loadtest-jtl-field-label">JTL 路径</span>
            <div className="loadtest-jtl-path-row">
              <input
                className="text-input loadtest-jtl-path"
                value={filePath}
                placeholder="浏览选择，或粘贴 results.jtl 的绝对路径"
                spellCheck={false}
                onChange={(e) => setFilePath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && filePath.trim()) void loadFromPath(filePath);
                }}
              />
              <button type="button" className="nav-btn nav-btn--compact" disabled={loading} onClick={() => void onBrowse()}>
                浏览…
              </button>
              {filePath.trim() ? (
                <button
                  type="button"
                  className="nav-btn nav-btn--compact"
                  title="在资源管理器中打开所在文件夹"
                  onClick={() => void onOpenContainingFolder()}
                >
                  打开目录
                </button>
              ) : null}
            </div>
          </label>
          <div className="loadtest-jtl-load-row">
            <button
              type="button"
              className="primary loadtest-jtl-load-btn"
              disabled={loading || !filePath.trim()}
              onClick={() => void loadFromPath(filePath)}
            >
              {loading ? "读取中…" : "加载 JTL"}
            </button>
            <p className="hint loadtest-jtl-load-hint">
              从「执行 JMX」完成后会自动填入路径；也可直接点右侧「生成 JMX」跳过预览。
            </p>
          </div>
        </section>

        <section
          className="loadtest-jtl-block loadtest-jtl-block--actions"
          aria-labelledby="jtl-export-heading"
        >
          <h4 id="jtl-export-heading" className="loadtest-jtl-block-title">
            导出
          </h4>
          <p className="hint loadtest-jtl-export-lede">
            需先有有效的 JTL 路径；未加载时会自动读取文件。
          </p>
          <div className="loadtest-jtl-export-actions">
            <button
              type="button"
              className="nav-btn nav-btn--accent loadtest-jtl-export-btn"
              disabled={!canAct || jmxBusy}
              onClick={() => void onExportJmx()}
            >
              {jmxBusy ? "正在生成…" : "生成 JMX"}
            </button>
            <button
              type="button"
              className="nav-btn loadtest-jtl-export-btn"
              disabled={!canAct || exporting}
              onClick={() => void onExportPdf()}
            >
              {exporting ? "正在生成 PDF…" : "导出 Dashboard PDF"}
            </button>
          </div>
        </section>
      </div>

      {parseErrors.length ? (
        <p className="loadtest-jtl-warn" role="status">
          {parseErrors.join(" ")}
        </p>
      ) : null}

      {summary && loaded ? (
        <div className="loadtest-jtl-summary" role="status">
          <span>
            样本 <strong>{summary.totalRows}</strong>
          </span>
          <span>
            HTTP <strong>{summary.httpSamples}</strong>
          </span>
          <span>
            标签 <strong>{summary.labels}</strong>
          </span>
          {summary.skippedWs ? (
            <span className="loadtest-jtl-muted">已忽略 WebSocket {summary.skippedWs}</span>
          ) : null}
          <span>
            时长 <strong>{(summary.wallMs / 1000).toFixed(2)}s</strong>
          </span>
          {filePath.trim() ? (
            <span className="loadtest-jtl-file-tag" title={filePath}>
              {sourceName}
            </span>
          ) : null}
        </div>
      ) : null}

      {dashboard ? (
        <div className="loadtest-jtl-results">
          <JmeterDashboardView
            testInfo={dashboard.testInfo}
            apdex={dashboard.apdex}
            statistics={dashboard.statistics}
            errors={dashboard.errors}
            top5BySampler={dashboard.top5BySampler}
          />
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
        </div>
      ) : (
        !loading && (
          <div className="loadtest-jtl-placeholder" role="status">
            <p className="loadtest-jtl-placeholder-title">暂无 Dashboard 数据</p>
            <p className="hint">选择 JTL 并点击「加载」，或从「执行 JMX」运行结束后自动跳转本页。</p>
          </div>
        )
      )}
    </div>
  );
}