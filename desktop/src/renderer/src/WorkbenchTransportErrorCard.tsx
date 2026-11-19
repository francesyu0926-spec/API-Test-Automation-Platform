import { useMemo, useState } from "react";

import {
  formatTransportTechnicalLog,
  type WorkbenchTransportErrorView,
} from "./workbenchNetworkError";

type Props = {
  view: WorkbenchTransportErrorView;
  fullLog: string;
  insecureTls: boolean;
  onToggleInsecure: (next: boolean) => void;
  onRetry: () => void;
  onCopied?: (hint?: string) => void;
};

export default function WorkbenchTransportErrorCard({
  view,
  fullLog,
  insecureTls,
  onToggleInsecure,
  onRetry,
  onCopied,
}: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const technical = useMemo(
    () => formatTransportTechnicalLog(fullLog, view.kind),
    [fullLog, view.kind],
  );

  const copyText = async (text: string, okMsg?: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      await navigator.clipboard.writeText(trimmed);
      onCopied?.(okMsg);
    } catch {
      onCopied?.("复制失败");
    }
  };

  const copyLog = () => void copyText(fullLog.trim());

  return (
    <div className="workbench-transport-error" role="alert">
      <header className="workbench-transport-error-head">
        <span className="workbench-transport-error-icon" aria-hidden />
        <h3 className="workbench-transport-error-title">{view.title}</h3>
      </header>

      <p className="workbench-transport-error-guidance">
        <span className="workbench-transport-error-guidance-icon" aria-hidden>
          💡
        </span>
        {view.guidance}
      </p>

      {view.kind === "tls" ? (
        <div className="workbench-transport-error-insecure-panel">
          <span className="workbench-transport-error-insecure-label">
            <span aria-hidden>⚙</span> 临时忽略证书校验
          </span>
          <label className="workbench-insecure-switch" title="等同 curl --insecure，仅建议内网调试">
            <input
              type="checkbox"
              role="switch"
              checked={insecureTls}
              aria-checked={insecureTls}
              onChange={(e) => onToggleInsecure(e.target.checked)}
            />
            <span className="workbench-insecure-switch-track" aria-hidden />
            <span className="workbench-insecure-switch-state">{insecureTls ? "已开启" : "关闭"}</span>
          </label>
        </div>
      ) : null}

      <button
        type="button"
        className="workbench-transport-error-details-toggle"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((o) => !o)}
      >
        <span className="workbench-transport-error-details-chevron" aria-hidden>
          {detailsOpen ? "▾" : "▸"}
        </span>
        {detailsOpen ? "收起技术详情" : "展开技术详情"}
      </button>

      {detailsOpen ? (
        <div className="workbench-transport-error-code-wrap">
          <div className="workbench-transport-error-code-head">
            <span className="workbench-transport-error-code-label">stderr</span>
            <button
              type="button"
              className="workbench-transport-error-code-copy"
              onClick={() => void copyText(technical.clipboardText, "已复制技术日志")}
            >
              复制日志
            </button>
          </div>
          <TransportCodeBlock english={technical.english} supplement={technical.supplement} />
        </div>
      ) : null}

      <div className="workbench-transport-error-actions">
        <button type="button" className="nav-btn nav-btn--ghost workbench-transport-error-copy" onClick={copyLog}>
          <span className="workbench-transport-error-btn-icon" aria-hidden>
            📋
          </span>
          复制错误日志
        </button>
        <button
          type="button"
          className={`primary workbench-transport-error-resend${
            view.kind === "tls" && insecureTls ? " workbench-transport-error-resend--armed" : ""
          }`}
          onClick={onRetry}
        >
          {view.kind === "tls" && insecureTls ? "忽略并重试" : "重新发送"}
        </button>
      </div>
    </div>
  );
}

function TransportCodeBlock({ english, supplement }: { english: string; supplement: string }) {
  return (
    <pre className="workbench-transport-error-details">
      <code>
        <span className="workbench-transport-error-code-line workbench-transport-error-code-line--err">
          <span className="workbench-transport-error-code-prompt" aria-hidden>
            &gt;
          </span>{" "}
          {english}
        </span>
        {supplement ? (
          <>
            {"\n"}
            <span className="workbench-transport-error-code-line workbench-transport-error-code-line--hint">
              <span className="workbench-transport-error-code-prompt" aria-hidden>
                &gt;
              </span>{" "}
              {supplement}
            </span>
          </>
        ) : null}
      </code>
    </pre>
  );
}