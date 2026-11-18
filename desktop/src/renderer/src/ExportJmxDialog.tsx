import { useEffect, useState } from "react";

import type { JmxExportOptions } from "./jmxExport";

type Props = {
  open: boolean;
  title: string;
  caseCount: number;
  collectionMode?: boolean;
  defaultPlanName: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (opts: JmxExportOptions, target: "project" | "dialog") => void;
};

export default function ExportJmxDialog({
  open,
  title,
  caseCount,
  collectionMode,
  defaultPlanName,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const [planName, setPlanName] = useState(defaultPlanName);
  const [threadGroupName, setThreadGroupName] = useState("Thread Group");
  const [threads, setThreads] = useState(10);
  const [rampUpSec, setRampUpSec] = useState(5);
  const [loops, setLoops] = useState(1);
  const [envName, setEnvName] = useState("dev");
  const [injectEnv, setInjectEnv] = useState(true);

  useEffect(() => {
    if (!open) return;
    setPlanName(defaultPlanName);
    setThreadGroupName("Thread Group");
    setInjectEnv(true);
  }, [open, defaultPlanName]);

  if (!open) return null;

  const opts: JmxExportOptions = {
    planName: planName.trim() || defaultPlanName,
    threadGroupName: threadGroupName.trim() || "Thread Group",
    threads: Math.max(1, threads),
    rampUpSec: Math.max(0, rampUpSec),
    loops: Math.max(1, loops),
    envName: envName.trim() || "dev",
    injectEnv,
  };

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-card modal-card--wide export-jmx-modal" role="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h4 className="modal-title">{title}</h4>
        <p className="hint" style={{ marginTop: 0 }}>
          {collectionMode
            ? `当前项目无 YAML 用例，将导出 API 集合中的 ${caseCount} 个请求。`
            : `将导出 ${caseCount} 个 HTTP 用例`}{" "}
          为 JMeter 5.x <code>.jmx</code>。请保持勾选「注入 token / secret」，与工作台 dev 环境一致。导出后请用<strong>新文件</strong>测试，勿继续用旧桌面 jmx。
        </p>
        <div className="grid-2 export-jmx-form" style={{ gap: 12, marginBottom: 16 }}>
          <label className="perf-field">
            <span>测试计划名称</span>
            <input className="text-input" value={planName} onChange={(e) => setPlanName(e.target.value)} />
          </label>
          <label className="perf-field">
            <span>线程组名称</span>
            <input
              className="text-input"
              value={threadGroupName}
              onChange={(e) => setThreadGroupName(e.target.value)}
            />
          </label>
          <label className="perf-field">
            <span>线程数</span>
            <input
              className="text-input"
              type="number"
              min={1}
              value={threads}
              onChange={(e) => setThreads(Number(e.target.value))}
            />
          </label>
          <label className="perf-field">
            <span>Ramp-Up（秒）</span>
            <input
              className="text-input"
              type="number"
              min={0}
              value={rampUpSec}
              onChange={(e) => setRampUpSec(Number(e.target.value))}
            />
          </label>
          <label className="perf-field">
            <span>循环次数</span>
            <input
              className="text-input"
              type="number"
              min={1}
              value={loops}
              onChange={(e) => setLoops(Number(e.target.value))}
            />
          </label>
          <label className="perf-field">
            <span>环境名</span>
            <input
              className="text-input"
              value={envName}
              onChange={(e) => setEnvName(e.target.value)}
              placeholder="dev"
            />
          </label>
          <label className="check-label" style={{ alignSelf: "end", paddingBottom: 6 }}>
            <input
              type="checkbox"
              checked={injectEnv}
              onChange={(e) => setInjectEnv(e.target.checked)}
            />
            注入 token / secret（environments/*.local.yaml）
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="nav-btn" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="nav-btn"
            disabled={busy}
            onClick={() => onConfirm(opts, "project")}
          >
            保存到项目 jmx/
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => onConfirm(opts, "dialog")}>
            {busy ? "保存中…" : "另存为…"}
          </button>
        </div>
      </div>
    </div>
  );
}