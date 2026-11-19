import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import AppCustomSelect from "./AppCustomSelect";
import {
  jmeterLogLineClass,
  jmeterVersionLabel,
  suggestJmeterOutputDir,
} from "./jmeterConsoleLog";
import {
  PERF_OTHER_PROJECT_LABEL,
  resolvePerfArchiveProjectId,
} from "../../shared/perfProject";
import { saveBytesWithDialog } from "./saveBytesWithDialog";

const DEFAULT_JMX_HINT =
  "D:\\Document\\LAB\\stockmarket_20260920\\jmeter\\行情接口 v2.jmx";

/** 与下拉选项区分：未选择时显示占位，归档仍归入「其他」 */
const ARCHIVE_PROJECT_UNSET = "__archive_unset__";

type ProjectOption = { id: string; name?: string };

type Props = {
  /** 侧栏当前工作区项目（用于默认归属） */
  project: string;
  projects: ProjectOption[];
  onToast: (msg: string) => void;
  onRunFinished?: (payload: {
    jtlPath: string;
    reportDir?: string;
    jmxPath: string;
    /** 空字符串表示归档到「其他」 */
    archiveProjectId: string;
  }) => void;
  /** 压测配置生成后预填路径 */
  initialJmxPath?: string;
  initialOutputDir?: string;
  /** 变化时自动执行（与 initialJmxPath 一并下发） */
  autoRunKey?: number;
  fromLoadTestConfig?: boolean;
};

export default function JmeterRunPanel({
  project,
  projects,
  onToast,
  onRunFinished,
  initialJmxPath,
  initialOutputDir,
  autoRunKey,
  fromLoadTestConfig,
}: Props) {
  const [jmxPath, setJmxPath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [jmeterHome, setJmeterHome] = useState("");
  const [jmeterOk, setJmeterOk] = useState<boolean | null>(null);
  const [generateReport, setGenerateReport] = useState(true);
  const [copyToProject, setCopyToProject] = useState(false);
  const [jvmArgs, setJvmArgs] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState("");
  const [autoScrollLog, setAutoScrollLog] = useState(true);
  const [projectJmxFiles, setProjectJmxFiles] = useState<string[]>([]);
  const [projectJmxPick, setProjectJmxPick] = useState("");
  const [lastRun, setLastRun] = useState<{
    jtlPath: string;
    reportDir?: string;
    outputDir: string;
  } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const jmxDropDepth = useRef(0);
  /** 压测归属项目（非必填）；未选或选「其他」→ projects/_other */
  const [archiveProjectPick, setArchiveProjectPick] = useState(ARCHIVE_PROJECT_UNSET);

  useEffect(() => {
    const off = window.atp.onJmeterLog(({ text }) => {
      setLog((prev) => prev + text);
    });
    return off;
  }, []);

  useEffect(() => {
    if (!autoScrollLog) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, running, autoScrollLog]);

  const refreshJmeter = useCallback(async () => {
    const res = await window.atp.detectJmeter(jmeterHome.trim() || undefined);
    setJmeterOk(res.found);
    if (res.found && res.jmeterHome) {
      setJmeterHome(res.jmeterHome);
    }
  }, [jmeterHome]);

  const onAutoDetectJmeter = useCallback(async () => {
    setJmeterOk(null);
    const res = await window.atp.detectJmeter(undefined);
    setJmeterOk(res.found);
    if (res.found && res.jmeterHome) {
      setJmeterHome(res.jmeterHome);
      onToast(`已自动检测到 JMeter：${res.jmeterHome}`);
    } else {
      onToast(res.error ?? "未找到 JMeter，请手动选择安装目录");
    }
  }, [onToast]);

  useEffect(() => {
    void refreshJmeter();
  }, [refreshJmeter]);

  const archiveProjectOptions = useMemo(
    () => [
      ...projects.map((p) => ({
        value: p.id,
        label: (p.name?.trim() || p.id) as string,
      })),
      { value: "", label: PERF_OTHER_PROJECT_LABEL },
    ],
    [projects],
  );

  const archiveProjectForSave =
    archiveProjectPick === ARCHIVE_PROJECT_UNSET ? "" : archiveProjectPick;

  const jmxLibraryProject = resolvePerfArchiveProjectId(archiveProjectForSave);

  useEffect(() => {
    void window.atp.listProjectJmxFiles(jmxLibraryProject).then((files) => {
      const sorted = [...files].sort((a, b) => b.localeCompare(a));
      setProjectJmxFiles(sorted);
    });
  }, [jmxLibraryProject]);

  const applyJmxPath = useCallback((filePath: string, fillOutput = true) => {
    setJmxPath(filePath);
    setProjectJmxPick("");
    if (fillOutput) {
      setOutputDir((prev) => (prev.trim() ? prev : suggestJmeterOutputDir(filePath)));
    }
  }, []);

  useEffect(() => {
    if (initialJmxPath?.trim()) applyJmxPath(initialJmxPath.trim(), false);
  }, [initialJmxPath, applyJmxPath]);

  useEffect(() => {
    if (initialOutputDir?.trim()) setOutputDir(initialOutputDir.trim());
  }, [initialOutputDir]);

  const onBrowseJmx = async () => {
    const picked = await window.atp.pickOpenFile({
      defaultPath: jmxPath || DEFAULT_JMX_HINT,
      filters: [{ name: "JMeter 测试计划", extensions: ["jmx"] }],
    });
    if (picked.cancelled || !picked.filePath) return;
    applyJmxPath(picked.filePath);
  };

  const onBrowseJmeterHome = async () => {
    const picked = await window.atp.pickOpenDirectory({
      defaultPath: jmeterHome.trim() || undefined,
      title: "选择 JMeter 安装目录（JMETER_HOME）",
    });
    if (picked.cancelled || !picked.dirPath) return;
    setJmeterHome(picked.dirPath);
    const res = await window.atp.detectJmeter(picked.dirPath);
    setJmeterOk(res.found);
    if (!res.found) onToast(res.error ?? "该目录不是有效的 JMeter 安装");
  };

  const onBrowseOutputDir = async () => {
    const defaultPath =
      outputDir.trim() ||
      (jmxPath.trim() ? jmxPath.replace(/[\\/][^\\/]+$/, "") : undefined);
    const picked = await window.atp.pickOpenDirectory({
      defaultPath,
      title: "选择 JMeter 输出目录",
    });
    if (picked.cancelled || !picked.dirPath) return;
    setOutputDir(picked.dirPath);
  };

  const onPickProjectJmx = (absPath: string) => {
    if (!absPath) return;
    setProjectJmxPick(absPath);
    applyJmxPath(absPath);
  };

  const onJmxDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    jmxDropDepth.current += 1;
  };

  const onJmxDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    jmxDropDepth.current -= 1;
  };

  const onJmxDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };

  const onJmxDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    jmxDropDepth.current = 0;
    const file = e.dataTransfer.files[0] as File & { path?: string };
    const filePath = file?.path ?? "";
    if (!filePath.toLowerCase().endsWith(".jmx")) {
      onToast("请拖入 .jmx 文件");
      return;
    }
    applyJmxPath(filePath);
  };

  const onExportJmxCopy = async () => {
    const p = jmxPath.trim();
    if (!p) {
      onToast("请先选择 JMX 文件");
      return;
    }
    const text = await window.atp.readAbsoluteFile(p);
    if (!text?.trim()) {
      onToast("无法读取 JMX 内容");
      return;
    }
    const name = p.replace(/^.*[\\/]/, "") || "plan.jmx";
    const res = await window.atp.saveTextWithDialog({
      defaultPath: name,
      content: text,
      filters: [{ name: "JMeter 测试计划", extensions: ["jmx"] }],
    });
    if (res.ok && res.filePath) onToast(`JMX 已保存：${res.filePath}`);
    else if (res.error) onToast(res.error);
  };

  const copyJmxToProject = async (absPath: string) => {
    if (!copyToProject) return;
    const targetProject = resolvePerfArchiveProjectId(archiveProjectForSave);
    const text = await window.atp.readAbsoluteFile(absPath);
    if (!text) return;
    const base = absPath.replace(/^.*[\\/]/, "").replace(/\.jmx$/i, "") || "imported";
    const rel = `projects/${targetProject}/jmx/${base}.jmx`;
    await window.atp.writeRepoFile(rel, text);
    onToast(`JMX 副本已写入 ${rel}`);
    const list = await window.atp.listProjectJmxFiles(targetProject);
    setProjectJmxFiles([...list].sort((a, b) => b.localeCompare(a)));
  };

  const executeJmx = useCallback(
    async (paths?: { jmx?: string; outDir?: string }) => {
      const jmxFile = (paths?.jmx ?? jmxPath).trim();
      const outDir = (paths?.outDir ?? outputDir).trim();
      if (!jmxFile) {
        onToast("请选择 .jmx 文件");
        return;
      }
      if (jmeterOk === false) {
        onToast("未检测到 JMeter，请设置 JMETER_HOME 或点「自动检测」");
        return;
      }
      if (paths?.jmx) setJmxPath(jmxFile);
      if (paths?.outDir) setOutputDir(outDir);
      const jmxProbe = await window.atp.readAbsoluteFile(jmxFile);
      if (jmxProbe == null) {
        onToast(`找不到或无法读取 JMX：${jmxFile}`);
        return;
      }
      setRunning(true);
      setLog("");
      setLastRun(null);
      try {
        if (copyToProject) await copyJmxToProject(jmxFile);
        const res = await window.atp.runJmeter({
          jmxPath: jmxFile,
          outputDir: outDir || undefined,
          jmeterHome: jmeterHome.trim() || undefined,
          generateReport,
          jvmArgs: jvmArgs.trim() || undefined,
        });
        if (res.cancelled) {
          onToast("已手动停止 JMeter");
          return;
        }
        if (!res.ok) {
          const msg = res.error ?? `JMeter 失败（退出码 ${res.exitCode ?? "?"}）`;
          onToast(msg.length > 120 ? `${msg.slice(0, 117)}…` : msg);
          return;
        }
        setLastRun({ jtlPath: res.jtlPath, reportDir: res.reportDir, outputDir: res.outputDir });
        if (res.warning) {
          onToast(res.warning);
        }
        onToast(`压测完成：${res.jtlPath}`);
        onRunFinished?.({
          jtlPath: res.jtlPath,
          reportDir: res.reportDir,
          jmxPath: res.jmxPath,
          archiveProjectId: archiveProjectForSave,
        });
      } catch (e) {
        onToast(e instanceof Error ? e.message : "执行失败");
      } finally {
        setRunning(false);
      }
    },
    [
      archiveProjectForSave,
      copyToProject,
      generateReport,
      jmeterHome,
      jmeterOk,
      jmxPath,
      jvmArgs,
      onRunFinished,
      onToast,
      outputDir,
    ],
  );

  const onRun = () => void executeJmx();

  const autoRunKeyRef = useRef(0);

  useEffect(() => {
    if (!autoRunKey || !initialJmxPath?.trim()) return;
    if (autoRunKeyRef.current === autoRunKey) return;
    if (jmeterOk === null) return;
    autoRunKeyRef.current = autoRunKey;
    const jmxFile = initialJmxPath.trim();
    const outDir = initialOutputDir?.trim() ?? "";
    setJmxPath(jmxFile);
    if (outDir) setOutputDir(outDir);
    const delay = jmeterOk === false ? 0 : 120;
    const id = window.setTimeout(() => void executeJmx({ jmx: jmxFile, outDir }), delay);
    return () => window.clearTimeout(id);
  }, [autoRunKey, initialJmxPath, initialOutputDir, jmeterOk, executeJmx]);

  const onStop = () => {
    void window.atp.cancelJmeter();
    onToast("正在停止 JMeter…");
  };

  const jmeterVersion = useMemo(() => {
    const home = jmeterHome.trim();
    if (!home || !jmeterOk) return null;
    return jmeterVersionLabel(home);
  }, [jmeterHome, jmeterOk]);

  const clearLog = () => setLog("");

  const exportLog = async () => {
    const text = log.trim();
    if (!text) {
      onToast("暂无日志可导出");
      return;
    }
    const base64 = btoa(unescape(encodeURIComponent(text)));
    const res = await saveBytesWithDialog({
      defaultPath: `jmeter-console-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log`,
      base64,
      filters: [{ name: "日志", extensions: ["log", "txt"] }],
    });
    if (res.ok) onToast(`已导出 ${res.filePath ?? "日志"}`);
    else if (!res.cancelled && res.error) onToast(res.error);
  };

  const logIsEmpty = !log.trim() && !running;
  const logLines = useMemo(() => (logIsEmpty ? [] : log.split(/\r?\n/)), [log, logIsEmpty]);

  const projectJmxOptions = useMemo(
    () =>
      projectJmxFiles.map((abs) => {
        const name = abs.replace(/^.*[\\/]/, "");
        return { value: abs, label: name, title: abs };
      }),
    [projectJmxFiles],
  );

  return (
    <div className="loadtest-jmeter-run-shell">
      {fromLoadTestConfig ? (
        <p className="loadtest-jmeter-run-from-config hint">
          已由「压测配置」生成测试计划并载入下方路径；可另存为本地文件或点「运行」执行。未点「生成并执行」时不会自动开跑。
        </p>
      ) : null}

      <header className="loadtest-jmeter-run-head">
        <div>
          <h3 className="loadtest-jmeter-run-title">导入并执行 JMX</h3>
          <p className="hint loadtest-jmeter-run-lede">
            本机 <code>jmeter -n</code> 非 GUI 执行，产出 <code>results.jtl</code>
            {generateReport ? " 与 report/" : ""}。压测归属项目可选，未选归入「其他」。
          </p>
        </div>
      </header>

      <div className="loadtest-jmeter-env-banner" aria-label="JMeter 环境">
        <span className="loadtest-jmeter-env-banner-label">JMETER_HOME</span>
        <div className="jmeter-input-group loadtest-jmeter-env-banner-input">
          <input
            className="text-input jmeter-input-group-control"
            value={jmeterHome}
            placeholder="C:\apache-jmeter-5.5"
            spellCheck={false}
            onChange={(e) => setJmeterHome(e.target.value)}
            onBlur={() => void refreshJmeter()}
          />
          <button
            type="button"
            className="jmeter-input-group-btn"
            title="浏览安装目录"
            aria-label="浏览 JMeter 目录"
            onClick={() => void onBrowseJmeterHome()}
          >
            📂
          </button>
        </div>
        <div className="loadtest-jmeter-env-actions">
          <button type="button" className="nav-btn nav-btn--compact" onClick={() => void onAutoDetectJmeter()}>
            自动检测
          </button>
          <button
            type="button"
            className="workbench-icon-btn workbench-icon-btn--tiny"
            title="重新检测当前目录"
            aria-label="重新检测"
            onClick={() => void refreshJmeter()}
          >
            ↻
          </button>
          {jmeterOk === true ? (
            <span className="loadtest-jmeter-ready-inline" title={jmeterHome} role="status">
              <span className="loadtest-jmeter-ready-dot loadtest-jmeter-ready-dot--ok" aria-hidden />
              已就绪{jmeterVersion ? ` v${jmeterVersion}` : ""}
            </span>
          ) : jmeterOk === false ? (
            <span className="loadtest-jmeter-ready-inline loadtest-jmeter-ready-inline--bad" role="status">
              <span className="loadtest-jmeter-ready-dot loadtest-jmeter-ready-dot--bad" aria-hidden />
              未检测到
            </span>
          ) : (
            <span className="hint loadtest-jmeter-run-detecting" role="status">
              检测中…
            </span>
          )}
        </div>
      </div>

      <div className="loadtest-jmeter-run-grid loadtest-jmeter-run-grid--v2">
        <section className="loadtest-jmeter-run-block loadtest-jmeter-run-block--plan" aria-labelledby="jmeter-plan-heading">
          <h4 id="jmeter-plan-heading" className="loadtest-jmeter-run-block-title">
            测试计划与输出
          </h4>

          <label className="loadtest-field loadtest-jmeter-run-field">
            <span>压测归属项目（可选）</span>
            <AppCustomSelect
              className="loadtest-jmeter-archive-project-select"
              value={
                archiveProjectPick === ARCHIVE_PROJECT_UNSET ? ARCHIVE_PROJECT_UNSET : archiveProjectPick
              }
              ariaLabel="压测结果归档到哪个项目"
              placeholder="未选 · 归入其他"
              options={archiveProjectOptions}
              onChange={(v) => setArchiveProjectPick(v)}
            />
            <p className="hint loadtest-jmeter-advanced-hint">
              非必填。不选择或选「{PERF_OTHER_PROJECT_LABEL}」时写入{" "}
              <code>projects/_other/perf</code>。
            </p>
          </label>

          {projectJmxOptions.length > 0 ? (
            <label className="loadtest-field loadtest-jmeter-run-field">
              <span>项目内 JMX</span>
              <AppCustomSelect
                className="loadtest-jmeter-project-jmx-select"
                value={projectJmxPick}
                ariaLabel="选择项目内已保存的 JMX"
                placeholder="近期平台生成的 JMX…"
                options={[{ value: "", label: "手动选择或输入路径…" }, ...projectJmxOptions]}
                onChange={(v) => {
                  if (!v) {
                    setProjectJmxPick("");
                    return;
                  }
                  onPickProjectJmx(v);
                }}
              />
            </label>
          ) : null}

          <label className="loadtest-field loadtest-jmeter-run-field">
            <span>.jmx 文件（可拖入）</span>
            <div
              className="jmeter-input-group loadtest-jmeter-jmx-drop"
              onDragEnter={onJmxDragEnter}
              onDragLeave={onJmxDragLeave}
              onDragOver={onJmxDragOver}
              onDrop={onJmxDrop}
            >
              <input
                className="text-input jmeter-input-group-control"
                value={jmxPath}
                placeholder={DEFAULT_JMX_HINT}
                spellCheck={false}
                onChange={(e) => setJmxPath(e.target.value)}
              />
              <button
                type="button"
                className="jmeter-input-group-btn"
                title="浏览 JMX 文件"
                aria-label="浏览 JMX 文件"
                onClick={() => void onBrowseJmx()}
              >
                📂
              </button>
              <button
                type="button"
                className="jmeter-input-group-btn"
                title="将当前 JMX 另存到任意目录"
                aria-label="另存 JMX"
                disabled={!jmxPath.trim()}
                onClick={() => void onExportJmxCopy()}
              >
                ⤓
              </button>
            </div>
          </label>
          <label className="loadtest-field loadtest-jmeter-run-field">
            <span>输出目录（可选）</span>
            <div className="jmeter-input-group">
              <input
                className="text-input jmeter-input-group-control"
                value={outputDir}
                placeholder="选择 JMX 后自动建议 run_时间戳"
                spellCheck={false}
                onChange={(e) => setOutputDir(e.target.value)}
              />
              <button
                type="button"
                className="jmeter-input-group-btn"
                title="选择输出文件夹"
                aria-label="选择输出文件夹"
                onClick={() => void onBrowseOutputDir()}
              >
                📂
              </button>
            </div>
          </label>

          <details
            className="loadtest-jmeter-advanced"
            open={advancedOpen}
            onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="loadtest-jmeter-advanced-summary">高级参数</summary>
            <label className="loadtest-field loadtest-jmeter-run-field">
              <span>JVM_ARGS</span>
              <input
                className="text-input"
                value={jvmArgs}
                placeholder="-Xms512m -Xmx2g"
                spellCheck={false}
                onChange={(e) => setJvmArgs(e.target.value)}
              />
              <p className="hint loadtest-jmeter-advanced-hint">写入 JMeter 启动环境的 JVM_ARGS（如堆内存）。</p>
            </label>
          </details>
        </section>

        <aside className="loadtest-jmeter-run-block loadtest-jmeter-run-block--actions" aria-labelledby="jmeter-run-heading">
          <h4 id="jmeter-run-heading" className="loadtest-jmeter-run-block-title">
            执行
          </h4>
          <div className="loadtest-jmeter-run-checks">
            <label className="check-label loadtest-jmeter-check">
              <input
                type="checkbox"
                checked={generateReport}
                onChange={(e) => setGenerateReport(e.target.checked)}
              />
              生成 HTML 报告
            </label>
            <label className="check-label loadtest-jmeter-check">
              <input
                type="checkbox"
                checked={copyToProject}
                onChange={(e) => setCopyToProject(e.target.checked)}
              />
              保存 JMX 副本到归属项目
            </label>
          </div>
          <div className="loadtest-jmeter-run-actions">
            <button
              type="button"
              className="primary loadtest-jmeter-run-run-btn"
              disabled={running || !jmxPath.trim()}
              onClick={() => void onRun()}
            >
              {running ? "JMeter 运行中…" : "执行 JMX"}
            </button>
            {running ? (
              <button type="button" className="loadtest-jmeter-stop-btn" onClick={onStop}>
                停止
              </button>
            ) : null}
            {lastRun ? (
              <div className="loadtest-jmeter-run-result">
                <p className="loadtest-jmeter-run-result-line">
                  <span className="loadtest-jmeter-run-result-label">JTL</span>
                  <code title={lastRun.jtlPath}>{lastRun.jtlPath}</code>
                </p>
                {lastRun.reportDir ? (
                  <p className="loadtest-jmeter-run-result-line">
                    <span className="loadtest-jmeter-run-result-label">Report</span>
                    <code title={lastRun.reportDir}>{lastRun.reportDir}</code>
                  </p>
                ) : null}
                <div className="loadtest-jmeter-run-result-actions">
                  <button
                    type="button"
                    className="nav-btn nav-btn--compact"
                    onClick={() => void window.atp.openPath(lastRun.outputDir)}
                  >
                    打开所在目录
                  </button>
                  {lastRun.reportDir ? (
                    <button
                      type="button"
                      className="nav-btn nav-btn--compact"
                      onClick={() => void window.atp.openPath(lastRun.reportDir!)}
                    >
                      HTML 报告
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="hint loadtest-jmeter-run-actions-hint">选择 .jmx 后点「执行 JMX」，日志在下方实时显示。</p>
            )}
          </div>
        </aside>
      </div>

      <section className="loadtest-jmeter-console" aria-label="运行日志">
        <div className="loadtest-jmeter-console-toolbar">
          <span className="loadtest-jmeter-console-title">Console Output</span>
          <div className="loadtest-jmeter-console-actions">
            <label className="loadtest-jmeter-console-autoscroll check-label">
              <input
                type="checkbox"
                checked={autoScrollLog}
                onChange={(e) => setAutoScrollLog(e.target.checked)}
              />
              自动滚动到底部
            </label>
            <button
              type="button"
              className="nav-btn nav-btn--compact nav-btn--ghost"
              disabled={!log.trim()}
              onClick={clearLog}
            >
              清空日志
            </button>
            <button
              type="button"
              className="nav-btn nav-btn--compact nav-btn--ghost"
              disabled={!log.trim()}
              onClick={() => void exportLog()}
            >
              导出日志
            </button>
          </div>
        </div>
        <div
          ref={logRef}
          className={`loadtest-jmeter-run-log${running ? " loadtest-jmeter-run-log--live" : ""}${
            logIsEmpty ? " loadtest-jmeter-run-log--idle" : ""
          }`}
          aria-live="polite"
        >
          {logIsEmpty ? (
            <span className="loadtest-jmeter-run-log-empty">
              &gt; Waiting for execution…
              <span className="loadtest-console-cursor" aria-hidden />
            </span>
          ) : (
            logLines.map((line, i) => (
              <div key={i} className={jmeterLogLineClass(line)}>
                {line || "\u00a0"}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}