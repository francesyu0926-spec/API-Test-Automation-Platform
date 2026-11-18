import { useMemo, useState } from "react";

import type { HttpBenchmarkReport, HttpBenchmarkSample } from "../../shared/apiWorkbenchTypes";

type Props = {
  report: HttpBenchmarkReport;
  limit?: number;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function sampleFailed(s: HttpBenchmarkSample): boolean {
  return !s.ok || Boolean(s.error?.trim());
}

function sampleNote(s: HttpBenchmarkSample): string {
  if (s.error?.trim()) return s.error.trim();
  if (!s.ok && s.status > 0) return `HTTP ${s.status}（非 2xx）`;
  if (s.warmup) return "预热样本";
  return "成功";
}

export default function BenchmarkSampleTable({ report, limit = 50 }: Props) {
  const [showWarmup, setShowWarmup] = useState(false);

  const { rows, warmupCount, maxDur, hasFailures, method, url } = useMemo(() => {
    const all = report.samples;
    const warmup = all.filter((s) => s.warmup);
    const measured = all.filter((s) => !s.warmup);
    const pool = showWarmup ? all : measured;
    const sorted = [...pool].sort((a, b) => a.index - b.index);
    const rows = sorted.slice(-limit);
    const maxDur = Math.max(...measured.map((s) => s.durationMs), 1);
    return {
      rows,
      warmupCount: warmup.length,
      maxDur,
      hasFailures: measured.some(sampleFailed),
      method: report.request.method,
      url: report.request.url,
    };
  }, [report, limit, showWarmup]);

  return (
    <section className="loadtest-samples-card" aria-labelledby="loadtest-samples-title">
      <header className="loadtest-samples-head">
        <div>
          <h4 id="loadtest-samples-title" className="loadtest-samples-title">
            请求样本
          </h4>
          <p className="loadtest-samples-request" title={url}>
            <span className={`method-tag method-${method.toLowerCase()}`}>{method}</span>
            <span className="loadtest-samples-url">{url}</span>
          </p>
        </div>
        <div className="loadtest-samples-toolbar">
          <span className="hint">显示 {rows.length} 条</span>
          {warmupCount > 0 ? (
            <label className="loadtest-samples-warmup-toggle">
              <input
                type="checkbox"
                checked={showWarmup}
                onChange={(e) => setShowWarmup(e.target.checked)}
              />
              含预热（{warmupCount}）
            </label>
          ) : null}
        </div>
      </header>

      <div className="loadtest-samples-table-wrap">
        <table className="loadtest-samples-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>结果</th>
              <th>状态码</th>
              <th>耗时</th>
              <th>响应大小</th>
              {hasFailures ? <th>说明</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const failed = sampleFailed(s);
              const statusOk = s.status >= 200 && s.status < 300;
              const note = sampleNote(s);
              return (
                <tr
                  key={s.index}
                  className={`loadtest-samples-row${failed ? " loadtest-samples-row--fail" : ""}${
                    s.warmup ? " loadtest-samples-row--warmup" : ""
                  }`}
                >
                  <td className="loadtest-samples-idx">{s.index + 1}</td>
                  <td>
                    <span className={`badge ${failed ? "failed" : "passed"}`}>
                      {failed ? "失败" : "成功"}
                    </span>
                  </td>
                  <td>
                    {s.status > 0 ? (
                      <span
                        className={`loadtest-samples-status${statusOk && !failed ? " loadtest-samples-status--ok" : " loadtest-samples-status--err"}`}
                      >
                        {s.status}
                      </span>
                    ) : (
                      <span className="hint">—</span>
                    )}
                  </td>
                  <td className="loadtest-samples-dur-cell">
                    <span className="loadtest-samples-dur">{s.durationMs} ms</span>
                    <span className="loadtest-samples-dur-track" aria-hidden>
                      <span
                        className="loadtest-samples-dur-bar"
                        style={{ width: `${Math.min(100, (s.durationMs / maxDur) * 100)}%` }}
                      />
                    </span>
                  </td>
                  <td className="loadtest-samples-size">{formatBytes(s.bodySize)}</td>
                  {hasFailures ? (
                    <td className="loadtest-samples-note">{failed || s.warmup ? note : "—"}</td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}