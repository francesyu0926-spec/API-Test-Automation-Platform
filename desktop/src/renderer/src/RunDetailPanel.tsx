import { useEffect, useMemo, useState } from "react";

type RunSummaryView = {
  id?: string;
  project?: string;
  suite?: string;
  environment?: string;
  status?: string;
  started_at?: string;
  finished_at?: string;
  stats?: { total?: number; passed?: number; failed?: number };
};

type RunStep = {
  case?: string;
  status?: string;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  request?: { method?: string; url?: string; headers?: Record<string, string> };
  response?: {
    status?: number;
    headers?: Record<string, string>;
    body_preview?: string;
  };
  assertions?: Array<{ ok?: boolean; name?: string; message?: string; type?: string }>;
};

function asSummary(raw: unknown): RunSummaryView | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as RunSummaryView;
}

function asSteps(raw: unknown[]): RunStep[] {
  return raw.filter((s) => s && typeof s === "object") as RunStep[];
}

function formatWhen(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

function runWallMs(summary: RunSummaryView): number | null {
  if (!summary.started_at || !summary.finished_at) return null;
  const a = new Date(summary.started_at).getTime();
  const b = new Date(summary.finished_at).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return b - a;
}

function statusTone(status?: string): string {
  const s = (status ?? "").toLowerCase();
  if (s === "passed") return "ok";
  if (s === "failed") return "err";
  return "warn";
}

type Props = {
  summary: unknown;
  steps: unknown[];
  projectNames?: Record<string, string>;
};

export default function RunDetailPanel({ summary: rawSummary, steps: rawSteps, projectNames = {} }: Props) {
  const summary = useMemo(() => asSummary(rawSummary), [rawSummary]);
  const steps = useMemo(() => asSteps(rawSteps), [rawSteps]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(steps.length ? 0 : null);

  useEffect(() => {
    setExpandedIndex(steps.length ? 0 : null);
  }, [rawSummary, rawSteps, steps.length]);

  if (!summary) {
    return <p className="hint run-detail-empty">无摘要数据</p>;
  }

  const wallMs = runWallMs(summary);
  const stats = summary.stats ?? { total: steps.length, passed: 0, failed: 0 };
  const total = stats.total ?? steps.length;
  const passed = stats.passed ?? steps.filter((s) => s.status === "passed").length;
  const failed = stats.failed ?? Math.max(0, total - passed);
  const passPct = total > 0 ? Math.round((passed / total) * 100) : 0;

  const projectId = summary.project ?? "";
  const projectLabel = projectId ? projectNames[projectId]?.trim() || projectId : "—";

  return (
    <div className="run-detail">
      <header className="run-detail-summary">
        <div className="run-detail-summary-top">
          <span className={`badge run-detail-status run-detail-status--${statusTone(summary.status)}`}>
            {summary.status ?? "—"}
          </span>
          <div className="run-detail-meta-chips">
            <span className="run-detail-meta-chip" title={projectId ? `项目 ID：${projectId}` : "项目"}>
              {projectLabel}
            </span>
            <span className="run-detail-meta-chip" title="套件">
              套件 {summary.suite}
            </span>
            <span className="run-detail-meta-chip" title="环境">
              环境 {summary.environment}
            </span>
          </div>
        </div>
        <div className="run-detail-stats-row">
          <div className="run-detail-stat">
            <span className="run-detail-stat-value">{total}</span>
            <span className="run-detail-stat-label">步骤</span>
          </div>
          <div className="run-detail-stat run-detail-stat--pass">
            <span className="run-detail-stat-value">{passed}</span>
            <span className="run-detail-stat-label">通过</span>
          </div>
          <div className="run-detail-stat run-detail-stat--fail">
            <span className="run-detail-stat-value">{failed}</span>
            <span className="run-detail-stat-label">失败</span>
          </div>
          {wallMs != null ? (
            <div className="run-detail-stat run-detail-stat--muted">
              <span className="run-detail-stat-value">{(wallMs / 1000).toFixed(1)}s</span>
              <span className="run-detail-stat-label">总耗时</span>
            </div>
          ) : null}
        </div>
        <div className="run-detail-progress" role="progressbar" aria-valuenow={passPct} aria-valuemin={0} aria-valuemax={100}>
          <div className="run-detail-progress-bar" style={{ width: `${passPct}%` }} />
        </div>
        <p className="hint run-detail-times">
          开始 {formatWhen(summary.started_at)}
          <span className="run-detail-times-sep">·</span>
          结束 {formatWhen(summary.finished_at)}
        </p>
      </header>

      <section className="run-detail-steps" aria-label="步骤明细">
        <h3 className="run-detail-steps-title">步骤 ({steps.length})</h3>
        {steps.length === 0 ? <p className="hint">无步骤记录</p> : null}
        <ol className="run-detail-step-list">
          {steps.map((step, index) => {
            const open = expandedIndex === index;
            const method = step.request?.method ?? "—";
            const url = step.request?.url ?? "";
            const httpStatus = step.response?.status;
            const assertionFail = (step.assertions ?? []).filter((a) => a.ok === false);
            return (
              <li key={`${step.case ?? index}-${index}`} className={`run-detail-step${open ? " run-detail-step--open" : ""}`}>
                <button
                  type="button"
                  className="run-detail-step-head"
                  aria-expanded={open}
                  onClick={() => setExpandedIndex(open ? null : index)}
                >
                  <span className="run-detail-step-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className={`badge run-detail-step-badge run-detail-step-badge--${statusTone(step.status)}`}>
                    {step.status ?? "—"}
                  </span>
                  <span className="run-detail-step-case">{step.case ?? `步骤 ${index + 1}`}</span>
                  <span
                    className={`cases-method-pill cases-method-pill--compact cases-method-pill--${method.toLowerCase()}`}
                  >
                    {method}
                  </span>
                  {httpStatus != null ? (
                    <span className={`run-detail-http run-detail-http--${httpStatus >= 200 && httpStatus < 300 ? "ok" : "err"}`}>
                      {httpStatus}
                    </span>
                  ) : null}
                  {step.duration_ms != null ? (
                    <span className="run-detail-duration">{Math.round(step.duration_ms)} ms</span>
                  ) : null}
                  <span className="run-detail-step-url" title={url}>
                    {url}
                  </span>
                </button>
                {open ? (
                  <div className="run-detail-step-body">
                    {(step.assertions?.length ?? 0) > 0 ? (
                      <div className="run-detail-block">
                        <h4 className="run-detail-block-title">断言</h4>
                        <ul className="run-detail-assertions">
                          {(step.assertions ?? []).map((a, ai) => (
                            <li
                              key={ai}
                              className={`run-detail-assertion${a.ok ? " run-detail-assertion--ok" : " run-detail-assertion--fail"}`}
                            >
                              <span className="run-detail-assertion-mark">{a.ok ? "✓" : "✗"}</span>
                              <span>{a.name ?? a.type ?? "断言"}</span>
                              {a.message ? <span className="hint"> — {a.message}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {assertionFail.length === 0 && step.status === "failed" ? (
                      <p className="hint run-detail-assertion-warn">未记录断言明细，请查看响应</p>
                    ) : null}
                    {step.response?.body_preview ? (
                      <div className="run-detail-block">
                        <h4 className="run-detail-block-title">响应预览</h4>
                        <pre className="run-detail-body-preview">{step.response.body_preview}</pre>
                      </div>
                    ) : null}
                    <details className="run-detail-raw">
                      <summary>原始 JSON</summary>
                      <pre className="run-detail-raw-pre">{JSON.stringify(step, null, 2)}</pre>
                    </details>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}