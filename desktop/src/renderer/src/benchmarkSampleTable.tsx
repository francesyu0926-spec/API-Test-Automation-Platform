import { useMemo, useState } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";

import type { HttpBenchmarkReport, HttpBenchmarkSample } from "../../shared/apiWorkbenchTypes";

const ROW_HEIGHT = 40;
const VIEWPORT_HEIGHT = 400;
const VIRTUAL_MIN_ROWS = 48;

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

function SampleRow({
  index,
  style,
  data,
}: ListChildComponentProps<{
  rows: HttpBenchmarkSample[];
  maxDur: number;
  hasFailures: boolean;
}>) {
  const { rows, maxDur, hasFailures } = data;
  const s = rows[index];
  const failed = sampleFailed(s);
  const statusOk = s.status >= 200 && s.status < 300;
  const note = sampleNote(s);
  return (
    <div
      style={style}
      className={`virtual-sample-row loadtest-samples-row${failed ? " loadtest-samples-row--fail" : ""}${
        s.warmup ? " loadtest-samples-row--warmup" : ""
      }`}
    >
      <span className="virtual-sample-cell virtual-sample-cell--idx">{s.index + 1}</span>
      <span className="virtual-sample-cell">
        <span className={`badge ${failed ? "failed" : "passed"}`}>{failed ? "失败" : "成功"}</span>
      </span>
      <span className="virtual-sample-cell virtual-sample-cell--code">
        {s.status > 0 ? (
          <span
            className={`loadtest-samples-status${statusOk && !failed ? " loadtest-samples-status--ok" : " loadtest-samples-status--err"}`}
          >
            {s.status}
          </span>
        ) : (
          "—"
        )}
      </span>
      <span className="virtual-sample-cell virtual-sample-cell--dur">
        <span className="loadtest-samples-dur">{s.durationMs} ms</span>
        <span className="loadtest-samples-dur-track" aria-hidden>
          <span
            className="loadtest-samples-dur-bar"
            style={{ width: `${Math.min(100, (s.durationMs / maxDur) * 100)}%` }}
          />
        </span>
      </span>
      <span className="virtual-sample-cell">{formatBytes(s.bodySize)}</span>
      {hasFailures ? (
        <span className="virtual-sample-cell virtual-sample-cell--note">
          {failed || s.warmup ? note : "—"}
        </span>
      ) : null}
    </div>
  );
}

export default function BenchmarkSampleTable({ report }: Props) {
  const [showWarmup, setShowWarmup] = useState(false);

  const { rows, warmupCount, maxDur, hasFailures, method, url, useVirtual } = useMemo(() => {
    const all = report.samples;
    const warmup = all.filter((s) => s.warmup);
    const measured = all.filter((s) => !s.warmup);
    const pool = showWarmup ? all : measured;
    const sorted = [...pool].sort((a, b) => a.index - b.index);
    const maxDur = Math.max(...measured.map((s) => s.durationMs), 1);
    return {
      rows: sorted,
      warmupCount: warmup.length,
      maxDur,
      hasFailures: measured.some(sampleFailed),
      method: report.request.method,
      url: report.request.url,
      useVirtual: sorted.length >= VIRTUAL_MIN_ROWS,
    };
  }, [report, showWarmup]);

  const listHeight = Math.min(VIEWPORT_HEIGHT, Math.max(ROW_HEIGHT * 6, rows.length * ROW_HEIGHT));

  const head = (
    <div className="virtual-sample-head benchmark-sample-head" role="row">
      <span className="virtual-sample-cell virtual-sample-cell--idx">序号</span>
      <span className="virtual-sample-cell">结果</span>
      <span className="virtual-sample-cell virtual-sample-cell--code">状态码</span>
      <span className="virtual-sample-cell virtual-sample-cell--dur">耗时</span>
      <span className="virtual-sample-cell">响应大小</span>
      {hasFailures ? <span className="virtual-sample-cell virtual-sample-cell--note">说明</span> : null}
    </div>
  );

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
          <span className="hint">
            {useVirtual ? `虚拟列表 ${rows.length} 条` : `显示 ${rows.length} 条`}
          </span>
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

      <div className="virtual-sample-table benchmark-sample-virtual">
        {head}
        {rows.length === 0 ? (
          <p className="hint loadtest-samples-empty">无样本</p>
        ) : (
          <FixedSizeList
            className="virtual-sample-list"
            height={listHeight}
            width="100%"
            itemCount={rows.length}
            itemSize={ROW_HEIGHT}
            itemData={{ rows, maxDur, hasFailures }}
            overscanCount={useVirtual ? 10 : 4}
          >
            {SampleRow}
          </FixedSizeList>
        )}
      </div>
    </section>
  );
}