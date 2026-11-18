import type {
  JmeterApdexRow,
  JmeterErrorRow,
  JmeterSamplerErrorRow,
  JmeterStatRow,
  JmeterTestInfo,
} from "../../shared/jmeterStatistics";
import { formatApdexThresholdMs } from "../../shared/jmeterStatistics";

function fmt(n: number, d = 2): string {
  if (!Number.isFinite(n)) return "0";
  return d === 0 ? String(Math.round(n)) : n.toFixed(d);
}

type Props = {
  testInfo: JmeterTestInfo;
  apdex: JmeterApdexRow[];
  statistics: JmeterStatRow[];
  errors: JmeterErrorRow[];
  top5BySampler: JmeterSamplerErrorRow[];
};

export default function JmeterDashboardView({ testInfo, apdex, statistics, errors, top5BySampler }: Props) {
  const total = statistics.find((r) => r.transaction === "Total");
  const ok = total ? total.sampleCount - total.errorCount : 0;
  const ko = total?.errorCount ?? 0;
  const okPct = total?.sampleCount ? (ok / total.sampleCount) * 100 : 0;
  const koPct = total?.sampleCount ? (ko / total.sampleCount) * 100 : 0;

  return (
    <div className="jmeter-dashboard">
      <section className="jmeter-dashboard-panel">
        <h4 className="jmeter-dashboard-title">Test and Report information</h4>
        <table className="jmeter-dashboard-infos">
          <tbody>
            <tr>
              <th>Source file</th>
              <td>{testInfo.sourceFile}</td>
            </tr>
            <tr>
              <th>Start Time</th>
              <td>{testInfo.startTime}</td>
            </tr>
            <tr>
              <th>End Time</th>
              <td>{testInfo.endTime}</td>
            </tr>
            <tr>
              <th>Duration</th>
              <td>{testInfo.durationMs} ms</td>
            </tr>
          </tbody>
        </table>
      </section>

      <div className="grid-2 jmeter-dashboard-apdex-row">
        <section className="jmeter-dashboard-panel">
          <h4 className="jmeter-dashboard-title">APDEX (Application Performance Index)</h4>
          <div className="loadtest-aggregate-table-wrap">
            <table className="jmeter-apdex-table jmeter-errors-table">
              <thead>
                <tr>
                  <th className="num">Apdex</th>
                  <th className="num">T (Toleration threshold)</th>
                  <th className="num">F (Frustration threshold)</th>
                  <th>Label</th>
                </tr>
              </thead>
              <tbody>
                {apdex.map((row) => (
                  <tr key={row.label} className={row.label === "Total" ? "loadtest-aggregate-total" : ""}>
                    <td className="num">{fmt(row.apdex, 3)}</td>
                    <td className="num">{formatApdexThresholdMs(row.satisfiedMs)}</td>
                    <td className="num">{formatApdexThresholdMs(row.toleratedMs)}</td>
                    <td className="jmeter-apdex-label">{row.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="jmeter-dashboard-panel jmeter-dashboard-panel--summary">
          <h4 className="jmeter-dashboard-title">Requests Summary</h4>
          <div className="jmeter-summary-bar" role="img" aria-label={`成功 ${ok}，失败 ${ko}`}>
            <div className="jmeter-summary-ok" style={{ width: `${okPct}%` }} />
            <div className="jmeter-summary-ko" style={{ width: `${koPct}%` }} />
          </div>
          <p className="hint jmeter-summary-legend">
            <span className="jmeter-dot jmeter-dot--ok" /> PASS {fmt(okPct, 2)}% ·{" "}
            <span className="jmeter-dot jmeter-dot--ko" /> FAIL {fmt(koPct, 2)}% · OK {ok} / KO {ko}
          </p>
        </section>
      </div>

      <section className="jmeter-dashboard-panel">
        <h4 className="jmeter-dashboard-title">Statistics</h4>
        <div className="loadtest-aggregate-table-wrap">
          <table className="loadtest-aggregate-table jmeter-statistics-table">
            <thead>
              <tr>
                <th>Transactions</th>
                <th className="num">#Samples</th>
                <th className="num">FAIL</th>
                <th className="num">Error %</th>
                <th className="num">Average</th>
                <th className="num">Min</th>
                <th className="num">Max</th>
                <th className="num">Median</th>
                <th className="num">90th</th>
                <th className="num">95th</th>
                <th className="num">99th</th>
                <th className="num">Throughput</th>
                <th className="num">Recv KB/s</th>
                <th className="num">Sent KB/s</th>
              </tr>
            </thead>
            <tbody>
              {statistics.map((r) => (
                <tr key={r.transaction} className={r.transaction === "Total" ? "loadtest-aggregate-total" : ""}>
                  <td className="loadtest-aggregate-label">{r.transaction}</td>
                  <td className="num">{r.sampleCount}</td>
                  <td className="num">{r.errorCount}</td>
                  <td className={`num${r.errorPct > 0 ? " loadtest-aggregate-error-pct" : ""}`}>
                    {fmt(r.errorPct)}%
                  </td>
                  <td className="num">{fmt(r.meanResTime, 0)}</td>
                  <td className="num">{fmt(r.minResTime, 0)}</td>
                  <td className="num">{fmt(r.maxResTime, 0)}</td>
                  <td className="num">{fmt(r.medianResTime, 0)}</td>
                  <td className="num">{fmt(r.pct1ResTime, 0)}</td>
                  <td className="num">{fmt(r.pct2ResTime, 0)}</td>
                  <td className="num">{fmt(r.pct3ResTime, 0)}</td>
                  <td className="num">{fmt(r.throughput)}</td>
                  <td className="num">{fmt(r.receivedKBytesPerSec)}</td>
                  <td className="num">{fmt(r.sentKBytesPerSec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid-2 jmeter-dashboard-errors">
        <section className="jmeter-dashboard-panel">
          <h4 className="jmeter-dashboard-title">Errors</h4>
          <table className="jmeter-errors-table">
            <thead>
              <tr>
                <th>Type of error</th>
                <th className="num">Count</th>
                <th className="num">% in errors</th>
              </tr>
            </thead>
            <tbody>
              {errors.length ? (
                errors.map((e) => (
                  <tr key={e.message}>
                    <td>{e.message}</td>
                    <td className="num">{e.count}</td>
                    <td className="num">{fmt(e.pct)}%</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="hint">
                    无
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="jmeter-dashboard-panel">
          <h4 className="jmeter-dashboard-title">Top 5 Errors by sampler</h4>
          <table className="jmeter-errors-table">
            <thead>
              <tr>
                <th>Sampler</th>
                <th>Error</th>
                <th className="num">#Samples</th>
              </tr>
            </thead>
            <tbody>
              {top5BySampler.length ? (
                top5BySampler.map((e) => (
                  <tr key={`${e.sampler}:${e.message}`}>
                    <td className="jmeter-sampler-cell">{e.sampler}</td>
                    <td>{e.message}</td>
                    <td className="num">{e.count}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="hint">
                    无
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}