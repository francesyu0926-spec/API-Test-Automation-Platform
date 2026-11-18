import { useMemo } from "react";

import type { HttpBenchmarkReport } from "../../shared/apiWorkbenchTypes";
import { latencyHistogram } from "./perfHistogram";

type Props = {
  report: HttpBenchmarkReport | null;
  running: boolean;
  project: string;
  onToast: (msg: string) => void;
};

export default function BenchmarkResults({ report, running, project, onToast }: Props) {
  const measuredDurations = useMemo(
    () => (report?.samples ?? []).filter((s) => !s.warmup).map((s) => s.durationMs),
    [report],
  );
  const histogram = useMemo(() => latencyHistogram(measuredDurations, 50), [measuredDurations]);

  const onSave = async () => {
    if (!report || !project) return;
    const res = await window.atp.savePerfReport(project, report);
    if (res.ok) onToast(`报告已保存：${res.relativePath}`);
  };

  const onCopySummary = async () => {
    if (!report) return;
    const s = report.stats;
    const o = report.options;
    const text = [
      `${report.request.method} ${report.request.url}`,
      `线程 ${o.concurrency}，循环 ${o.loops ?? "—"}，Ramp-Up ${o.rampUpSec ?? 0}s`,
      `样本 ${s.samples}，成功 ${s.success}，失败 ${s.failed}，${s.wallMs} ms，${s.rps} req/s`,
      `延迟 ms — min ${s.latency.min} · avg ${s.latency.avg} · p50 ${s.latency.p50} · p95 ${s.latency.p95} · p99 ${s.latency.p99} · max ${s.latency.max}`,
      `状态码：${JSON.stringify(s.statusCodes)}`,
    ].join("\n");
    await window.atp.copyText(text);
    onToast("已复制性能摘要");
  };

  if (running) {
    return (
      <div className="loadtest-report-placeholder">
        <p>压测执行中…</p>
        <p className="hint">JMeter 式线程组正在按 Ramp-Up 拉起并发送请求</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="loadtest-report-placeholder">
        <p>聚合报告</p>
        <p className="hint">配置线程组与 HTTP 请求后，点击「启动」查看统计结果</p>
      </div>
    );
  }

  return (
    <div className="workbench-perf loadtest-report">
      <div className="perf-metrics">
        <MetricCard label="样本" value={String(report.stats.samples)} />
        <MetricCard label="成功" value={String(report.stats.success)} tone="ok" />
        <MetricCard
          label="失败"
          value={String(report.stats.failed)}
          tone={report.stats.failed ? "err" : undefined}
        />
        <MetricCard label="吞吐" value={`${report.stats.rps} req/s`} />
        <MetricCard label="p50" value={`${report.stats.latency.p50} ms`} />
        <MetricCard label="p95" value={`${report.stats.latency.p95} ms`} />
        <MetricCard label="p99" value={`${report.stats.latency.p99} ms`} />
        <MetricCard label="avg" value={`${report.stats.latency.avg} ms`} />
        <MetricCard
          label="min–max"
          value={`${report.stats.latency.min}–${report.stats.latency.max} ms`}
        />
      </div>

      <div className="perf-actions">
        <button type="button" className="nav-btn" disabled={!project} onClick={() => void onSave()}>
          保存报告
        </button>
        <button type="button" className="nav-btn" onClick={() => void onCopySummary()}>
          复制摘要
        </button>
      </div>

      <div className="grid-2 perf-detail-grid">
        <div>
          <h4 className="sub-title">延迟分布</h4>
          <pre className="code-block perf-histogram">{histogram.join("\n") || "(无数据)"}</pre>
        </div>
        <div>
          <h4 className="sub-title">状态码</h4>
          <pre className="code-block">{JSON.stringify(report.stats.statusCodes, null, 2)}</pre>
        </div>
      </div>

      <h4 className="sub-title">察看结果树（最近 50 条）</h4>
      <div className="workbench-kv perf-samples">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>预热</th>
              <th>耗时</th>
              <th>状态</th>
              <th>大小</th>
              <th>错误</th>
            </tr>
          </thead>
          <tbody>
            {report.samples.slice(-50).map((s) => (
              <tr key={s.index}>
                <td>{s.index + 1}</td>
                <td>{s.warmup ? "是" : ""}</td>
                <td>{s.durationMs} ms</td>
                <td>{s.status || "—"}</td>
                <td>{s.bodySize} B</td>
                <td className="url-cell">{s.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: "ok" | "err" }) {
  return (
    <div className={`perf-metric${tone ? ` perf-metric--${tone}` : ""}`}>
      <div className="perf-metric-label">{label}</div>
      <div className="perf-metric-value">{value}</div>
    </div>
  );
}