type Props = {
  show: boolean;
  parsedRows: number;
  /** 可选预估总量（未知时仅显示已解析数） */
  estimatedTotal?: number | null;
  logTail?: string;
};

export default function HeavyJtlLoadOverlay({ show, parsedRows, estimatedTotal, logTail }: Props) {
  if (!show) return null;

  const ratio =
    estimatedTotal && estimatedTotal > 0
      ? Math.min(100, Math.round((parsedRows / estimatedTotal) * 100))
      : null;

  return (
    <div className="heavy-load-overlay" role="dialog" aria-modal="true" aria-busy="true" aria-label="解析 JTL">
      <div className="heavy-load-card">
        <p className="heavy-load-title">正在流式解析 JTL（内存占用极低）…</p>
        <div
          className={`heavy-load-progress${ratio == null ? " heavy-load-progress--indeterminate" : ""}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={ratio ?? undefined}
        >
          <span
            className="heavy-load-progress-fill"
            style={ratio != null ? { width: `${ratio}%` } : undefined}
          />
        </div>
        <p className="heavy-load-stats">
          已解析样本：
          <strong>{parsedRows.toLocaleString("zh-CN")}</strong>
          {estimatedTotal != null && estimatedTotal > 0 ? (
            <>
              {" "}
              / {estimatedTotal.toLocaleString("zh-CN")}
            </>
          ) : (
            " …"
          )}
        </p>
        {logTail?.trim() ? (
          <p className="heavy-load-log" aria-live="polite">
            {logTail}
          </p>
        ) : null}
      </div>
    </div>
  );
}