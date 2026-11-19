import { useEffect, useMemo, useState } from "react";

import RunStepContextJson from "./RunStepContextJson";
import RunStepResponsePreview from "./RunStepResponsePreview";
import { assertionTableCells } from "./runDetailAssertions";

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
  assertions?: Array<{
    ok?: boolean;
    name?: string;
    message?: string;
    type?: string;
    expected?: number;
    actual?: number;
    max?: number;
    text?: string;
    error?: string;
  }>;
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
  const projectId = summary.project ?? "";
  const projectLabel = projectId ? projectNames[projectId]?.trim() || projectId : "—";

  const execTimeLabel =
    wallMs != null && wallMs >= 60_000 ? (
      <>
        开始 {formatWhen(summary.started_at)}
        <span className="run-detail-times-sep">·</span>
        结束 {formatWhen(summary.finished_at)}
      </>
    ) : (
      <>执行时间 {formatWhen(summary.finished_at ?? summary.started_at)}</>
    );

  return (
    <div className="run-detail">
      <header className="run-detail-summary">
        <div className="run-detail-summary-top">
          <div className="run-detail-summary-top-main">
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
          <p className="hint run-detail-summary-time">{execTimeLabel}</p>
        </div>
        <div
          className="run-detail-stats-row"
          role="group"
          aria-label={`步骤 ${total}，通过 ${passed}，失败 ${failed}${wallMs != null ? `，总耗时 ${(wallMs / 1000).toFixed(1)} 秒` : ""}`}
        >
          <div className="run-detail-stat">
            <span className="run-detail-stat-value">{total}</span>
            <span className="run-detail-stat-label">步骤</span>
          </div>
          <div className="run-detail-stat run-detail-stat--pass">
            <span className="run-detail-stat-value">{passed}</span>
            <span className="run-detail-stat-label">通过</span>
          </div>
          <div className={`run-detail-stat run-detail-stat--fail${failed > 0 ? " run-detail-stat--warn" : ""}`}>
            <span className="run-detail-stat-value">{failed}</span>
            <span className="run-detail-stat-label">失败</span>
          </div>
          {wallMs != null ? (
            <div className="run-detail-stat run-detail-stat--duration">
              <span className="run-detail-stat-value">{(wallMs / 1000).toFixed(1)}s</span>
              <span className="run-detail-stat-label">总耗时</span>
            </div>
          ) : null}
        </div>
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
                  <div className="run-detail-step-head-row">
                    <div className="run-detail-step-head-left">
                      <span
                        className={`run-detail-step-chevron${open ? " run-detail-step-chevron--open" : ""}`}
                        aria-hidden
                      />
                      <span className="run-detail-step-index">{String(index + 1).padStart(2, "0")}</span>
                      <span className="run-detail-step-case">{step.case ?? `步骤 ${index + 1}`}</span>
                      <span className={`badge run-detail-step-badge run-detail-step-badge--${statusTone(step.status)}`}>
                        {step.status ?? "—"}
                      </span>
                    </div>
                    <div className="run-detail-step-head-meta">
                      <span
                        className={`run-detail-method-pill run-detail-method-pill--${method.toLowerCase()}`}
                      >
                        {method}
                      </span>
                      {httpStatus != null ? (
                        <span
                          className={`run-detail-status-pill run-detail-status-pill--${
                            httpStatus >= 200 && httpStatus < 300 ? "ok" : "err"
                          }`}
                        >
                          {httpStatus}
                        </span>
                      ) : null}
                      {step.duration_ms != null ? (
                        <span className="run-detail-latency-pill">{Math.round(step.duration_ms)} ms</span>
                      ) : null}
                    </div>
                  </div>
                  {url ? (
                    <span className="run-detail-step-url-line" title={url}>
                      {url}
                    </span>
                  ) : null}
                </button>
                {open ? (
                  <div className="run-detail-step-body">
                    {(step.assertions?.length ?? 0) > 0 ? (
                      <div className="run-detail-block">
                        <h4 className="run-detail-block-title">断言</h4>
                        <div
                          className="run-detail-assertions-table-wrap"
                          role="table"
                          aria-label="断言结果"
                        >
                          <div className="run-detail-assertions-table-head" role="row">
                            <span role="columnheader">项</span>
                            <span role="columnheader">期望</span>
                            <span role="columnheader">实际</span>
                            <span role="columnheader" className="run-detail-assertions-col-result">
                              结果
                            </span>
                          </div>
                          {(step.assertions ?? []).map((a, ai) => {
                            const cells = assertionTableCells(a);
                            return (
                              <div
                                key={ai}
                                role="row"
                                className={`run-detail-assertions-table-row${
                                  a.ok ? " run-detail-assertions-table-row--ok" : " run-detail-assertions-table-row--fail"
                                }`}
                              >
                                <span className="run-detail-assertions-label" role="cell">
                                  {cells.label}
                                </span>
                                <span className="run-detail-assertions-expect" role="cell">
                                  {cells.expect}
                                </span>
                                <span
                                  className={`run-detail-assertions-actual${
                                    a.ok ? "" : " run-detail-assertions-actual--fail"
                                  }`}
                                  role="cell"
                                >
                                  {cells.actual}
                                </span>
                                <span className="run-detail-assertions-result" role="cell">
                                  <span
                                    className={`run-detail-assertions-mark${a.ok ? " run-detail-assertions-mark--ok" : " run-detail-assertions-mark--fail"}`}
                                    aria-hidden
                                  >
                                    {a.ok ? "✓" : "✗"}
                                  </span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    {assertionFail.length === 0 && step.status === "failed" ? (
                      <p className="hint run-detail-assertion-warn">未记录断言明细，请查看响应</p>
                    ) : null}
                    {step.response?.body_preview ? (
                      <RunStepResponsePreview bodyPreview={step.response.body_preview} />
                    ) : null}
                    <RunStepContextJson step={step as Record<string, unknown>} />
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