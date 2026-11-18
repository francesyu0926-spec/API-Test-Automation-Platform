import { useMemo, useState } from "react";

import type { HttpBenchmarkReport, HttpSendPayload, WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import { resolveWorkbenchPayload } from "./resolveWorkbenchRequest";
import { latencyHistogram } from "./perfHistogram";

type Props = {
  draft: WorkbenchDraft;
  project: string;
  variables: Record<string, string>;
  disabled: boolean;
  onToast: (msg: string) => void;
};

export default function PerfPanel({ draft, project, variables, disabled, onToast }: Props) {
  const [total, setTotal] = useState(30);
  const [concurrency, setConcurrency] = useState(3);
  const [warmup, setWarmup] = useState(3);
  const [timeoutMs, setTimeoutMs] = useState(30_000);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<HttpBenchmarkReport | null>(null);

  const buildPayload = (): HttpSendPayload | null => {
    if (!draft.url.trim()) return null;
    try {
      return { ...resolveWorkbenchPayload(draft, variables), timeoutMs };
    } catch {
      return null;
    }
  };

  const onRun = async () => {
    const payload = buildPayload();
    if (!payload) {
      onToast("请先填写 URL，或检查环境变量是否齐全");
      return;
    }
    setRunning(true);
    setReport(null);
    try {
      const result = await window.atp.runHttpBenchmark(
        payload,
        { total, concurrency, warmup, timeoutMs },
        { name: draft.name },
      );
      setReport(result);
      if (result.cancelled) onToast("已停止压测");
      else onToast(`完成：成功率 ${Math.round((result.stats.success / Math.max(1, result.stats.samples)) * 100)}%`);
    } finally {
      setRunning(false);
    }
  };

  const onStop = () => {
    void window.atp.cancelHttpBenchmark();
    onToast("正在停止…");
  };

  const onSave = async () => {
    if (!report || !project) return;
    const res = await window.atp.savePerfReport(project, report);
    if (res.ok) onToast(`报告已保存：${res.relativePath}`);
  };

  const onCopySummary = async () => {
    if (!report) return;
    const s = report.stats;
    const text = [
      `${report.request.method} ${report.request.url}`,
      `样本 ${s.samples}，成功 ${s.success}，失败 ${s.failed}，${s.wallMs} ms 总耗时，${s.rps} req/s`,
      `延迟 ms — min ${s.latency.min} · avg ${s.latency.avg} · p50 ${s.latency.p50} · p95 ${s.latency.p95} · p99 ${s.latency.p99} · max ${s.latency.max}`,
      `状态码：${JSON.stringify(s.statusCodes)}`,
    ].join("\n");
    await window.atp.copyText(text);
    onToast("已复制性能摘要");
  };

  const measuredDurations = useMemo(
    () => (report?.samples ?? []).filter((s) => !s.warmup).map((s) => s.durationMs),
    [report],
  );

  const histogram = useMemo(() => latencyHistogram(measuredDurations, 50), [measuredDurations]);

  return (
    <div className="workbench-perf">
      <div className="workbench-perf-form">
        <label className="perf-field">
          <span>总次数</span>
          <input
            type="number"
            className="text-input"
            min={1}
            max={500}
            value={total}
            disabled={running}
            onChange={(e) => setTotal(Number(e.target.value) || 1)}
          />
        </label>
        <label className="perf-field">
          <span>并发</span>
          <input
            type="number"
            className="text-input"
            min={1}
            max={50}
            value={concurrency}
            disabled={running}
            onChange={(e) => setConcurrency(Number(e.target.value) || 1)}
          />
        </label>
        <label className="perf-field">
          <span>预热</span>
          <input
            type="number"
            className="text-input"
            min={0}
            max={total - 1}
            value={warmup}
            disabled={running}
            onChange={(e) => setWarmup(Number(e.target.value) || 0)}
          />
        </label>
        <label className="perf-field">
          <span>超时(ms)</span>
          <input
            type="number"
            className="text-input"
            min={1000}
            step={1000}
            value={timeoutMs}
            disabled={running}
            onChange={(e) => setTimeoutMs(Number(e.target.value) || 30_000)}
          />
        </label>
        <button type="button" className="primary" disabled={disabled || running} onClick={() => void onRun()}>
          {running ? "压测中…" : "开始压测"}
        </button>
        {running && (
          <button type="button" className="nav-btn" onClick={onStop}>
            停止
          </button>
        )}
      </div>

      {running && <div className="perf-progress">…</div>}

      {report && (
        <div className="perf-results">
          <div className="perf-metrics">
            <MetricCard label="样本" value={String(report.stats.samples)} />
            <MetricCard label="成功" value={String(report.stats.success)} tone="ok" />
            <MetricCard label="失败" value={String(report.stats.failed)} tone={report.stats.failed ? "err" : undefined} />
            <MetricCard label="吞吐" value={`${report.stats.rps} req/s`} />
            <MetricCard label="p50" value={`${report.stats.latency.p50} ms`} />
            <MetricCard label="p95" value={`${report.stats.latency.p95} ms`} />
            <MetricCard label="p99" value={`${report.stats.latency.p99} ms`} />
            <MetricCard label="avg" value={`${report.stats.latency.avg} ms`} />
            <MetricCard label="min–max" value={`${report.stats.latency.min}–${report.stats.latency.max} ms`} />
          </div>

          <div className="perf-actions">
            <button type="button" className="nav-btn" onClick={() => void onSave()}>
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

          <h4 className="sub-title">明细（最近 50 条）</h4>
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
      )}
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