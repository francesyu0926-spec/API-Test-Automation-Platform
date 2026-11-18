import type { HttpBenchmarkReport } from "../../shared/apiWorkbenchTypes";
import { summarizeBenchmarkErrors } from "./aggregateReportTable";

type Props = {
  open: boolean;
  title: string;
  text: string;
  report?: HttpBenchmarkReport | null;
  defaultFileName: string;
  onClose: () => void;
  onToast: (msg: string) => void;
};

function statusCodeClass(code: string): string {
  const n = Number.parseInt(code, 10);
  if (n >= 200 && n < 300) return "perf-summary-status--ok";
  if (n >= 400) return "perf-summary-status--fail";
  return "perf-summary-status--other";
}

function PerfSummaryIconCopy() {
  return (
    <svg className="perf-summary-btn-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M4 2.5A1.5 1.5 0 0 1 5.5 1H11A1.5 1.5 0 0 1 12.5 2.5V9H11V2.5A.5.5 0 0 0 10.5 2H5.5a.5.5 0 0 0-.5.5V9H4V2.5ZM2 4.5A1.5 1.5 0 0 1 3.5 3H10v1H3.5a.5.5 0 0 0-.5.5v8A.5.5 0 0 0 3.5 13h6A.5.5 0 0 0 10 12.5V12h1v.5A1.5 1.5 0 0 1 9.5 14h-6A1.5 1.5 0 0 1 2 12.5v-8Z"
      />
    </svg>
  );
}

function PerfSummaryIconDownload() {
  return (
    <svg className="perf-summary-btn-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M8 1.25a.75.75 0 0 1 .75.75v6.19l1.72-1.72a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06l1.72 1.72V2a.75.75 0 0 1 .75-.75Z"
      />
      <path fill="currentColor" d="M2.75 12.25a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H2.75Z" />
    </svg>
  );
}

export default function PerfSummaryDialog({
  open,
  title,
  text,
  report,
  defaultFileName,
  onClose,
  onToast,
}: Props) {
  if (!open) return null;

  const onCopy = async () => {
    await window.atp.copyText(text);
    onToast("已复制摘要");
  };

  const onCopyPath = async () => {
    if (!report) return;
    const path =
      report.provenance?.sourceJtl?.trim() ||
      report.provenance?.jmxPath?.trim() ||
      report.request.url;
    if (!path) return;
    await window.atp.copyText(path);
    onToast("已复制路径");
  };

  const onSaveTxt = async () => {
    const res = await window.atp.saveTextWithDialog({
      defaultPath: defaultFileName,
      content: text.endsWith("\n") ? text : `${text}\n`,
      filters: [{ name: "纯文本", extensions: ["txt"] }],
    });
    if (res.cancelled) return;
    if (res.filePath) onToast(`已保存：${res.filePath}`);
    else onToast(res.error ?? "保存失败");
  };

  const body = report ? <PerfSummaryBody report={report} onCopyPath={() => void onCopyPath()} /> : (
    <pre className="loadtest-perf-summary-text loadtest-perf-summary-text--plain">{text}</pre>
  );

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="modal-card modal-card--wide loadtest-perf-summary-modal"
        role="dialog"
        aria-labelledby="perf-summary-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="loadtest-perf-summary-head">
          <div>
            <h4 id="perf-summary-title" className="modal-title loadtest-perf-summary-title">
              {title}
            </h4>
            <p className="hint loadtest-perf-summary-lede">结构化摘要；完整纯文本可复制或另存为 .txt。</p>
          </div>
          <button
            type="button"
            className="loadtest-perf-summary-close"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {body}

        <div className="modal-actions loadtest-perf-summary-actions">
          <button type="button" className="loadtest-perf-summary-btn-secondary" onClick={() => void onCopy()}>
            <PerfSummaryIconCopy /> 复制
          </button>
          <button type="button" className="primary loadtest-perf-summary-btn-primary" onClick={() => void onSaveTxt()}>
            <PerfSummaryIconDownload /> 另存为 TXT…
          </button>
        </div>
      </div>
    </div>
  );
}

function PerfSummaryBody({
  report,
  onCopyPath,
}: {
  report: HttpBenchmarkReport;
  onCopyPath: () => void;
}) {
  const { stats: s, options: o } = report;
  const errors = summarizeBenchmarkErrors(report);
  const sourcePath =
    report.provenance?.sourceJtl?.trim() ||
    report.provenance?.jmxPath?.trim() ||
    report.request.url?.trim() ||
    "—";
  const failCls = s.failed > 0 ? "perf-summary-kpi--fail" : "perf-summary-kpi--ok";

  const latencyItems = [
    { label: "Min", value: s.latency.min },
    { label: "Avg", value: s.latency.avg, accent: true },
    { label: "P50", value: s.latency.p50 },
    { label: "P90", value: s.latency.p90 },
    { label: "P95", value: s.latency.p95 },
    { label: "P99", value: s.latency.p99 },
    { label: "Max", value: s.latency.max },
  ];

  const statusEntries = Object.entries(s.statusCodes).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );

  return (
    <div className="loadtest-perf-summary-body">
      <p className="loadtest-perf-summary-meta">
        线程 <strong>{o.concurrency}</strong> · 循环 <strong>{o.loops ?? "—"}</strong> · Ramp-Up{" "}
        <strong>{o.rampUpSec ?? 0}s</strong> · 墙钟 <strong>{s.wallMs} ms</strong>
      </p>

      <div className="perf-summary-kpi-row">
        <div className="perf-summary-kpi">
          <span className="perf-summary-kpi-label">样本</span>
          <span className="perf-summary-kpi-value">{s.samples}</span>
        </div>
        <div className="perf-summary-kpi perf-summary-kpi--success">
          <span className="perf-summary-kpi-label">成功</span>
          <span className="perf-summary-kpi-value">{s.success}</span>
        </div>
        <div className={`perf-summary-kpi ${failCls}`}>
          <span className="perf-summary-kpi-label">失败</span>
          <span className="perf-summary-kpi-value">{s.failed}</span>
        </div>
        <div className="perf-summary-kpi">
          <span className="perf-summary-kpi-label">吞吐</span>
          <span className="perf-summary-kpi-value">{s.rps} req/s</span>
        </div>
      </div>

      <h5 className="perf-summary-section-title">延迟分布 (ms)</h5>
      <div className="perf-summary-latency-grid">
        {latencyItems.map((item) => (
          <div
            key={item.label}
            className={`perf-summary-latency-tag${item.accent ? " perf-summary-latency-tag--accent" : ""}`}
          >
            <span className="perf-summary-latency-k">{item.label}</span>
            <span className="perf-summary-latency-v">{item.value}</span>
          </div>
        ))}
      </div>

      {statusEntries.length > 0 ? (
        <>
          <h5 className="perf-summary-section-title">状态码</h5>
          <div className="perf-summary-status-row">
            {statusEntries.map(([code, count]) => (
              <span key={code} className={`perf-summary-status-tag ${statusCodeClass(code)}`}>
                <span className="perf-summary-status-dot" aria-hidden />
                {code}: {count} 次
              </span>
            ))}
          </div>
        </>
      ) : null}

      {errors.length > 0 ? (
        <>
          <h5 className="perf-summary-section-title">错误</h5>
          <ul className="perf-summary-errors">
            {errors.map((e) => (
              <li key={`${e.message}-${e.count}`}>
                <span className="perf-summary-error-count">{e.count}×</span> {e.message}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="perf-summary-path-row">
        <label className="perf-summary-path-label">源文件</label>
        <div className="perf-summary-path-field">
          <input
            type="text"
            className="perf-summary-path-input"
            readOnly
            value={sourcePath}
            title={sourcePath}
          />
          <button
            type="button"
            className="perf-summary-path-copy"
            title="复制路径"
            aria-label="复制路径"
            onClick={onCopyPath}
          >
            📋
          </button>
        </div>
      </div>
    </div>
  );
}

export function perfSummaryFileName(report: { startedAt: string; id: string }): string {
  const stamp = report.startedAt.replace(/[:.]/g, "-").slice(0, 19);
  const idPart = report.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12) || "run";
  return `perf-summary-${stamp}-${idPart}.txt`;
}