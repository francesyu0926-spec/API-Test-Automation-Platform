import type {
  JmeterApdexRow,
  JmeterErrorRow,
  JmeterSamplerErrorRow,
  JmeterStatRow,
  JmeterTestInfo,
} from "../../shared/jmeterStatistics";
import { formatApdexThresholdMs } from "../../shared/jmeterStatistics";
import type { PercentileApproxMeta } from "../../shared/jtlStreamAggregator";
import { PercentileApproxMark, PercentileTh, percentileApproxTooltip } from "./percentileApprox";
import { repairJtlTextField } from "../../shared/jtlTextRepair";
import { saveBytesWithDialog } from "./saveBytesWithDialog";
import {
  apdexScoreClass,
  APDEX_TIER_FAIR,
  APDEX_TIER_GOOD,
  assertion200TooltipText,
  assertionFailLeadLabel,
  errorBriefLabel,
  formatErrorDisplayMessage,
  formatJmeterCount,
  isAssertionFailDisplay,
  jmeterErrorPctClass,
  jmeterErrorsSharePctClass,
  jmeterFailCountClass,
  statisticsToCsv,
} from "./jmeterDashboardUi";

function fmt(n: number, d = 2): string {
  if (!Number.isFinite(n)) return "0";
  return d === 0 ? String(Math.round(n)) : n.toFixed(d);
}

export type JmeterDashboardSection = "overview" | "stats" | "errors" | "charts";

type Props = {
  visibleSection: JmeterDashboardSection;
  testInfo: JmeterTestInfo;
  apdex: JmeterApdexRow[];
  statistics: JmeterStatRow[];
  errors: JmeterErrorRow[];
  top5BySampler: JmeterSamplerErrorRow[];
  percentileMeta?: PercentileApproxMeta | null;
  onToast?: (msg: string) => void;
};

function AssertionFailBadgeRow({ lead }: { lead: string }) {
  return (
    <>
      <span
        className="jmeter-error-warn-icon jmeter-error-tip-anchor"
        data-tip={assertion200TooltipText()}
        tabIndex={0}
        role="img"
        aria-label={assertion200TooltipText()}
      >
        ⚠
      </span>
      <span className="jmeter-error-assert-lead">{lead}</span>
      <span className="jmeter-error-assert-badge">断言失败</span>
    </>
  );
}

function ErrorMessageCell({ message }: { message: string }) {
  const text = repairJtlTextField(message);
  const display = formatErrorDisplayMessage(text);
  const showAssertBadge = isAssertionFailDisplay(text);
  return (
    <td
      className={`jmeter-error-msg-cell${showAssertBadge ? " jmeter-error-msg-cell--assert" : ""}`}
      title={display}
    >
      {showAssertBadge ? (
        <span className="jmeter-error-assert-row">
          <AssertionFailBadgeRow lead={assertionFailLeadLabel(text)} />
        </span>
      ) : (
        <span className="jmeter-ellipsis">{display}</span>
      )}
    </td>
  );
}

function Top5ErrorBriefCell({ message }: { message: string }) {
  const text = repairJtlTextField(message);
  const display = formatErrorDisplayMessage(text);
  const brief = errorBriefLabel(text);
  const showAssertBadge = isAssertionFailDisplay(text);
  return (
    <td className="jmeter-top5-error-brief" title={display}>
      {showAssertBadge ? (
        <span className="jmeter-error-assert-row jmeter-error-assert-row--compact">
          <span className="jmeter-error-assert-lead">200 OK</span>
          <span className="jmeter-error-assert-badge">断言失败</span>
        </span>
      ) : (
        <span className="jmeter-top5-error-brief-text">{brief}</span>
      )}
    </td>
  );
}

function JmeterErrorsShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        d="M24 6 10 12v10c0 9 6 17 14 19 8-2 14-10 14-19V12L24 6Z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 24.5 22 28.5l8-8"
      />
    </svg>
  );
}

export default function JmeterDashboardView({
  visibleSection,
  testInfo,
  apdex,
  statistics,
  errors,
  top5BySampler,
  percentileMeta,
  onToast,
}: Props) {
  const total = statistics.find((r) => r.transaction === "Total");
  const ok = total ? total.sampleCount - total.errorCount : 0;
  const ko = total?.errorCount ?? 0;
  const okPct = total?.sampleCount ? (ok / total.sampleCount) * 100 : 0;
  const koPct = total?.sampleCount ? (ko / total.sampleCount) * 100 : 0;

  const globalApdex = apdex.find((r) => r.label === "Total") ?? apdex[0];
  const hideApdexThresholdCols =
    apdex.length > 1 &&
    apdex.every(
      (r) =>
        r.satisfiedMs === globalApdex?.satisfiedMs && r.toleratedMs === globalApdex?.toleratedMs,
    );

  const exportStatisticsCsv = async () => {
    const csv = statisticsToCsv(statistics);
    const base64 = btoa(unescape(encodeURIComponent(`\uFEFF${csv}`)));
    const base = testInfo.sourceFile.replace(/\.jtl$/i, "") || "statistics";
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const res = await saveBytesWithDialog({
      defaultPath: `jmeter-statistics-${base}-${stamp}.csv`,
      base64,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (res.ok) onToast?.(`已导出 ${res.filePath ?? "Statistics CSV"}`);
    else if (!res.cancelled && res.error) onToast?.(res.error);
  };

  const showOverview = visibleSection === "overview";
  const showStats = visibleSection === "stats";
  const showErrors = visibleSection === "errors";
  const totalSamples = total?.sampleCount ?? 0;
  const totalErrors = total?.errorCount ?? 0;
  const errorsIsEmpty = totalErrors === 0 && errors.length === 0 && top5BySampler.length === 0;
  const showLowSampleHint =
    errorsIsEmpty &&
    totalSamples > 0 &&
    (totalSamples < 30 || testInfo.durationMs < 3000);
  return (
    <div className="jmeter-dashboard">
      {showOverview ? (
        <>
          <div className="grid-2 jmeter-dashboard-apdex-row">
            <section className="jmeter-dashboard-panel">
              <div className="jmeter-apdex-head">
                <h4 className="jmeter-dashboard-title jmeter-apdex-panel-title">
                  APDEX (Application Performance Index)
                </h4>
                {hideApdexThresholdCols && globalApdex ? (
                  <button
                    type="button"
                    className="jmeter-apdex-info-btn"
                    title={`容忍阈值 T：${formatApdexThresholdMs(globalApdex.satisfiedMs)}；沮丧阈值 F：${formatApdexThresholdMs(globalApdex.toleratedMs)}。分数色标：绿=优(≥${APDEX_TIER_GOOD})，黄=中(≥${APDEX_TIER_FAIR})，红=差(<${APDEX_TIER_FAIR})。`}
                    aria-label="APDEX 阈值与色标说明"
                  >
                    ⓘ
                  </button>
                ) : null}
              </div>
              {hideApdexThresholdCols && globalApdex ? (
                <p className="hint jmeter-apdex-global-thresholds">
                  容忍阈值 T：{formatApdexThresholdMs(globalApdex.satisfiedMs)} · 沮丧阈值 F：
                  {formatApdexThresholdMs(globalApdex.toleratedMs)}
                </p>
              ) : null}
              {hideApdexThresholdCols ? (
                <div className="jmeter-apdex-legend-line" role="note" aria-label="Apdex 色标">
                  <span className="jmeter-apdex-pill jmeter-apdex-pill--good">优 ≥{APDEX_TIER_GOOD}</span>
                  <span className="jmeter-apdex-pill jmeter-apdex-pill--fair">中 ≥{APDEX_TIER_FAIR.toFixed(2)}</span>
                  <span className="jmeter-apdex-pill jmeter-apdex-pill--poor">差 &lt;{APDEX_TIER_FAIR.toFixed(2)}</span>
                </div>
              ) : null}
              <div className="loadtest-aggregate-table-wrap">
                <table className="jmeter-apdex-table jmeter-errors-table jmeter-dashboard-data-table jmeter-apdex-table--compact">
                  <thead>
                    <tr>
                      <th className="jmeter-apdex-score-col">Apdex</th>
                      {!hideApdexThresholdCols ? (
                        <>
                          <th className="num">T (Toleration threshold)</th>
                          <th className="num">F (Frustration threshold)</th>
                        </>
                      ) : null}
                      <th className="jmeter-apdex-label-col">Label</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apdex.map((row) => (
                      <tr key={row.label} className={row.label === "Total" ? "loadtest-aggregate-total" : ""}>
                        <td className="jmeter-apdex-score-col">
                          <span className={apdexScoreClass(row.apdex)}>{fmt(row.apdex, 3)}</span>
                        </td>
                        {!hideApdexThresholdCols ? (
                          <>
                            <td className="num">{formatApdexThresholdMs(row.satisfiedMs)}</td>
                            <td className="num">{formatApdexThresholdMs(row.toleratedMs)}</td>
                          </>
                        ) : null}
                        <td className="jmeter-apdex-label jmeter-ellipsis" title={row.label}>
                          {row.label}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="jmeter-dashboard-panel jmeter-dashboard-panel--summary">
              <h4 className="jmeter-dashboard-title">Requests Summary</h4>
              <div
                className={`jmeter-summary-bar${okPct > 0 && koPct > 0 ? " jmeter-summary-bar--split" : ""}`}
                role="img"
                aria-label={`成功 ${ok}，失败 ${ko}`}
              >
                <div className="jmeter-summary-ok" style={{ width: `${okPct}%` }}>
                  <span className="jmeter-summary-bar-label">{okPct > 8 ? `PASS ${fmt(okPct, 0)}%` : ""}</span>
                </div>
                <div className="jmeter-summary-ko" style={{ width: `${koPct}%` }}>
                  <span className="jmeter-summary-bar-label">{koPct > 8 ? `FAIL ${fmt(koPct, 0)}%` : ""}</span>
                </div>
              </div>
              <p className="hint jmeter-summary-legend">
                <span className="jmeter-dot jmeter-dot--ok" /> PASS {fmt(okPct, 2)}% · OK {ok}
                <span className="jmeter-summary-legend-sep" />
                <span className="jmeter-dot jmeter-dot--ko" /> FAIL {fmt(koPct, 2)}% · KO {ko}
              </p>
            </section>
          </div>
        </>
      ) : null}

      {showStats ? (
        <section className="jmeter-dashboard-panel jmeter-dashboard-panel--stats">
          <div className="jmeter-statistics-toolbar">
            <div className="jmeter-statistics-toolbar-start">
              <h4 className="jmeter-statistics-toolbar-title">事务明细</h4>
              <PercentileApproxMark meta={percentileMeta} />
            </div>
            <button
              type="button"
              className="nav-btn nav-btn--compact jmeter-statistics-export-btn"
              onClick={() => void exportStatisticsCsv()}
            >
              <span className="jmeter-statistics-export-icon" aria-hidden>
                ⬇
              </span>
              导出 CSV
            </button>
          </div>
          {percentileApproxTooltip(percentileMeta) ? (
            <p className="hint percentile-approx-foot jmeter-statistics-foot">{percentileApproxTooltip(percentileMeta)}</p>
          ) : null}
          <div className="loadtest-aggregate-table-wrap jmeter-statistics-scroll">
            <table className="loadtest-aggregate-table jmeter-statistics-table jmeter-dashboard-data-table">
              <colgroup>
                <col className="jmeter-stat-col-label" />
                <col className="jmeter-stat-col-num" />
                <col className="jmeter-stat-col-num" />
                <col className="jmeter-stat-col-num" />
                <col className="jmeter-stat-col-ms" />
                <col className="jmeter-stat-col-ms" />
                <col className="jmeter-stat-col-ms" />
                <col className="jmeter-stat-col-ms" />
                <col className="jmeter-stat-col-ms" />
                <col className="jmeter-stat-col-ms" />
                <col className="jmeter-stat-col-ms" />
                <col className="jmeter-stat-col-tps" />
                <col className="jmeter-stat-col-kb" />
                <col className="jmeter-stat-col-kb" />
              </colgroup>
              <thead>
                <tr>
                  <th className="jmeter-stat-label-col">Transactions</th>
                  <th className="num">#Samples</th>
                  <th className="num">FAIL</th>
                  <th className="num">Error %</th>
                  <th className="num">
                    Average <span className="jmeter-stat-th-unit">(ms)</span>
                  </th>
                  <th className="num">
                    Min <span className="jmeter-stat-th-unit">(ms)</span>
                  </th>
                  <th className="num">
                    Max <span className="jmeter-stat-th-unit">(ms)</span>
                  </th>
                  <th className="num">
                    Median <span className="jmeter-stat-th-unit">(ms)</span>
                  </th>
                  <PercentileTh label="90th (ms)" meta={percentileMeta} />
                  <PercentileTh label="95th (ms)" meta={percentileMeta} />
                  <PercentileTh label="99th (ms)" meta={percentileMeta} />
                  <th className="num">
                    Throughput <span className="jmeter-stat-th-unit">(/s)</span>
                  </th>
                  <th className="num">
                    Recv <span className="jmeter-stat-th-unit">(KB/s)</span>
                  </th>
                  <th className="num">
                    Sent <span className="jmeter-stat-th-unit">(KB/s)</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {statistics.map((r) => (
                  <tr key={r.transaction} className={r.transaction === "Total" ? "loadtest-aggregate-total" : ""}>
                    <td className="loadtest-aggregate-label jmeter-stat-label-col jmeter-ellipsis" title={r.transaction}>
                      {r.transaction}
                    </td>
                    <td className="num jmeter-num">{r.sampleCount}</td>
                    <td className={`num jmeter-num ${jmeterFailCountClass(r.errorCount)}`}>{r.errorCount}</td>
                    <td className={`num jmeter-num ${jmeterErrorPctClass(r.errorPct)}`}>{fmt(r.errorPct)}%</td>
                    <td className="num jmeter-num">{fmt(r.meanResTime, 0)}</td>
                    <td className="num jmeter-num">{fmt(r.minResTime, 0)}</td>
                    <td className="num jmeter-num">{fmt(r.maxResTime, 0)}</td>
                    <td className="num jmeter-num">{fmt(r.medianResTime, 0)}</td>
                    <td className="num jmeter-num">{fmt(r.pct1ResTime, 0)}</td>
                    <td className="num jmeter-num">{fmt(r.pct2ResTime, 0)}</td>
                    <td className="num jmeter-num">{fmt(r.pct3ResTime, 0)}</td>
                    <td className="num jmeter-num">{fmt(r.throughput)}</td>
                    <td className="num jmeter-num">{fmt(r.receivedKBytesPerSec)}</td>
                    <td className="num jmeter-num">{fmt(r.sentKBytesPerSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {showErrors ? (
        <>
          {errorsIsEmpty ? (
            <section className="jmeter-dashboard-panel jmeter-errors-zero-panel" aria-live="polite">
              <div className="jmeter-errors-zero-unified">
                <JmeterErrorsShieldIcon className="jmeter-errors-zero-icon-svg" />
                <p className="jmeter-errors-zero-head">异常摘要</p>
                <p className="jmeter-errors-zero-stat">0 错误</p>
                <p className="jmeter-errors-zero-text">本次压测未发现异常请求及采样器错误。</p>
              </div>
              {showLowSampleHint ? (
                <p className="jmeter-errors-foot-hint">
                  当前样本量较少，建议增加线程数或循环次数以获得更准确的压测结果。
                </p>
              ) : null}
            </section>
          ) : (
            <>
              <div className="jmeter-dashboard-errors">
                <section className="jmeter-dashboard-panel jmeter-dashboard-panel--errors-narrow">
                  <h4 className="jmeter-dashboard-title jmeter-dashboard-title--left">异常摘要</h4>
                  <div className="jmeter-errors-scroll">
                    <table className="jmeter-errors-table jmeter-dashboard-data-table">
                      <thead>
                        <tr>
                          <th>异常摘要</th>
                          <th className="num">Count</th>
                          <th className="num">% in errors</th>
                        </tr>
                      </thead>
                      <tbody>
                        {errors.map((e) => (
                          <tr key={e.message}>
                            <ErrorMessageCell message={e.message} />
                            <td className="num jmeter-num">{formatJmeterCount(e.count)}</td>
                            <td className={`num jmeter-num ${jmeterErrorsSharePctClass(e.pct)}`}>
                              {fmt(e.pct)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="jmeter-dashboard-panel jmeter-dashboard-panel--errors-wide">
                  <h4 className="jmeter-dashboard-title jmeter-dashboard-title--left">错误请求 Top 5</h4>
                  <div className="jmeter-errors-scroll">
                    <table className="jmeter-errors-table jmeter-dashboard-data-table jmeter-top5-errors-table">
                      <thead>
                        <tr>
                          <th className="jmeter-top5-sampler-col">Sampler</th>
                          <th className="jmeter-top5-error-col">Error</th>
                          <th className="num">#Samples</th>
                        </tr>
                      </thead>
                      <tbody>
                        {top5BySampler.map((e) => (
                          <tr key={`${e.sampler}:${e.message}`}>
                            <td className="jmeter-sampler-cell jmeter-ellipsis" title={e.sampler}>
                              {e.sampler}
                            </td>
                            <Top5ErrorBriefCell message={e.message} />
                            <td className="num jmeter-num">{formatJmeterCount(e.count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </>
          )}
        </>
      ) : null}

    </div>
  );
}