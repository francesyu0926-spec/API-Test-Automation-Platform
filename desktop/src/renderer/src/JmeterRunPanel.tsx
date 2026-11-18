import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_JMX_HINT =
  "D:\\Document\\LAB\\stockmarket_20260920\\jmeter\\行情接口 v2.jmx";

type Props = {
  project: string;
  onToast: (msg: string) => void;
  onRunFinished?: (payload: { jtlPath: string; reportDir?: string; jmxPath: string }) => void;
};

export default function JmeterRunPanel({ project, onToast, onRunFinished }: Props) {
  const [jmxPath, setJmxPath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [jmeterHome, setJmeterHome] = useState("");
  const [jmeterOk, setJmeterOk] = useState<boolean | null>(null);
  const [generateReport, setGenerateReport] = useState(true);
  const [copyToProject, setCopyToProject] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState("");
  const [lastRun, setLastRun] = useState<{
    jtlPath: string;
    reportDir?: string;
    outputDir: string;
  } | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const off = window.atp.onJmeterLog(({ text }) => {
      setLog((prev) => prev + text);
    });
    return off;
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, running]);

  const refreshJmeter = useCallback(async () => {
    const res = await window.atp.detectJmeter(jmeterHome.trim() || undefined);
    setJmeterOk(res.found);
    if (res.found && res.jmeterHome && !jmeterHome.trim()) {
      setJmeterHome(res.jmeterHome);
    }
  }, [jmeterHome]);

  useEffect(() => {
    void refreshJmeter();
  }, [refreshJmeter]);

  const onBrowseJmx = async () => {
    const picked = await window.atp.pickOpenFile({
      defaultPath: jmxPath || DEFAULT_JMX_HINT,
      filters: [{ name: "JMeter 测试计划", extensions: ["jmx"] }],
    });
    if (picked.cancelled || !picked.filePath) return;
    setJmxPath(picked.filePath);
    if (!outputDir.trim()) {
      const dir = picked.filePath.replace(/[\\/][^\\/]+$/, "");
      setOutputDir(`${dir}\\run_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);
    }
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

  const copyJmxToProject = async (absPath: string) => {
    if (!project || !copyToProject) return;
    const text = await window.atp.readAbsoluteFile(absPath);
    if (!text) return;
    const base = absPath.replace(/^.*[\\/]/, "").replace(/\.jmx$/i, "") || "imported";
    const rel = `projects/${project}/jmx/${base}.jmx`;
    await window.atp.writeRepoFile(rel, text);
    onToast(`JMX 副本已写入 ${rel}`);
  };

  const onRun = async () => {
    if (!jmxPath.trim()) {
      onToast("请选择 .jmx 文件");
      return;
    }
    if (jmeterOk === false) {
      onToast("未检测到 JMeter，请设置 JMETER_HOME 或填写安装目录");
      return;
    }
    setRunning(true);
    setLog("");
    setLastRun(null);
    try {
      if (copyToProject) await copyJmxToProject(jmxPath.trim());
      const res = await window.atp.runJmeter({
        jmxPath: jmxPath.trim(),
        outputDir: outputDir.trim() || undefined,
        jmeterHome: jmeterHome.trim() || undefined,
        generateReport,
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
      onToast(`压测完成：${res.jtlPath}`);
      onRunFinished?.({ jtlPath: res.jtlPath, reportDir: res.reportDir, jmxPath: res.jmxPath });
    } catch (e) {
      onToast(e instanceof Error ? e.message : "执行失败");
    } finally {
      setRunning(false);
    }
  };

  const onStop = () => {
    void window.atp.cancelJmeter();
    onToast("正在停止 JMeter…");
  };

  return (
    <div className="loadtest-jmeter-run-shell">
      <header className="loadtest-jmeter-run-head">
        <div>
          <h3 className="loadtest-jmeter-run-title">导入并执行 JMX</h3>
          <p className="hint loadtest-jmeter-run-lede">
            本机 <code>jmeter -n</code> 非 GUI 执行，产出 <code>results.jtl</code>
            {generateReport ? " 与 report/" : ""}。
          </p>
        </div>
        <div className="loadtest-jmeter-run-status">
          {jmeterOk === true ? (
            <span className="loadtest-jmeter-run-ok">JMeter 可用</span>
          ) : jmeterOk === false ? (
            <span className="loadtest-jmeter-run-warn">未检测到 JMeter</span>
          ) : (
            <span className="hint">检测中…</span>
          )}
          <button type="button" className="nav-btn nav-btn--compact" onClick={() => void refreshJmeter()}>
            重新检测
          </button>
        </div>
      </header>

      <div className="loadtest-jmeter-run-grid">
        <section className="loadtest-jmeter-run-block" aria-labelledby="jmeter-env-heading">
          <h4 id="jmeter-env-heading" className="loadtest-jmeter-run-block-title">
            环境
          </h4>
          <label className="loadtest-field loadtest-jmeter-run-field">
            <span>JMETER_HOME</span>
            <input
              className="text-input"
              value={jmeterHome}
              placeholder="C:\apache-jmeter-5.5"
              spellCheck={false}
              onChange={(e) => setJmeterHome(e.target.value)}
            />
          </label>
        </section>

        <section className="loadtest-jmeter-run-block" aria-labelledby="jmeter-plan-heading">
          <h4 id="jmeter-plan-heading" className="loadtest-jmeter-run-block-title">
            计划与输出
          </h4>
          <label className="loadtest-field loadtest-jmeter-run-field">
            <span>测试计划 (.jmx)</span>
            <div className="loadtest-jtl-path-row">
              <input
                className="text-input loadtest-jtl-path"
                value={jmxPath}
                placeholder={DEFAULT_JMX_HINT}
                spellCheck={false}
                onChange={(e) => setJmxPath(e.target.value)}
              />
              <button type="button" className="nav-btn" onClick={() => void onBrowseJmx()}>
                浏览…
              </button>
            </div>
          </label>
          <label className="loadtest-field loadtest-jmeter-run-field">
            <span>输出目录（可选）</span>
            <div className="loadtest-jtl-path-row">
              <input
                className="text-input loadtest-jtl-path"
                value={outputDir}
                placeholder="默认在 JMX 同级创建 run_时间戳"
                spellCheck={false}
                onChange={(e) => setOutputDir(e.target.value)}
              />
              <button type="button" className="nav-btn" onClick={() => void onBrowseOutputDir()}>
                选择文件夹…
              </button>
            </div>
          </label>
        </section>

        <aside className="loadtest-jmeter-run-block loadtest-jmeter-run-block--actions">
          <h4 className="loadtest-jmeter-run-block-title">执行</h4>
          <div className="loadtest-jmeter-run-checks">
            <label className="check-label">
              <input
                type="checkbox"
                checked={generateReport}
                onChange={(e) => setGenerateReport(e.target.checked)}
              />
              生成 HTML 报告
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={copyToProject}
                disabled={!project}
                onChange={(e) => setCopyToProject(e.target.checked)}
              />
              保存 JMX 副本到项目
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
            <button type="button" className="nav-btn" disabled={!running} onClick={onStop}>
              停止
            </button>
          </div>

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
                  输出文件夹
                </button>
                {lastRun.reportDir ? (
                  <button
                    type="button"
                    className="nav-btn nav-btn--compact"
                    onClick={() => void window.atp.openPath(lastRun.reportDir!)}
                  >
                    report
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="hint loadtest-jmeter-run-actions-hint">选择 .jmx 后点「执行 JMX」，日志在下方实时显示。</p>
          )}
        </aside>
      </div>

      <section className="loadtest-jmeter-run-log-section" aria-label="运行日志">
        <div className="loadtest-jmeter-run-log-head">
          <span className="sub-title">运行日志</span>
          <span className="hint">
            {running ? "实时输出 · jmeter.log" : log ? "已完成" : "执行后显示"}
          </span>
        </div>
        <pre
          ref={logRef}
          className={`loadtest-jmeter-run-log${running ? " loadtest-jmeter-run-log--live" : ""}`}
          aria-live="polite"
        >
          {log || (running ? "等待 JMeter 输出…" : "（尚未执行）")}
        </pre>
      </section>
    </div>
  );
}