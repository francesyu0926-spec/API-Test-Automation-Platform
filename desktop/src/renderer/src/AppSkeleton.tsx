type LineProps = {
  width?: string;
  height?: number;
  className?: string;
};

export function SkeletonLine({ width = "100%", height = 12, className = "" }: LineProps) {
  return (
    <span
      className={`atp-skeleton atp-skeleton-line${className ? ` ${className}` : ""}`}
      style={{ width, height }}
      aria-hidden
    />
  );
}

export function SkeletonListRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="atp-skeleton-list" aria-hidden aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="atp-skeleton-list-row">
          <SkeletonLine width={`${68 - (i % 3) * 8}%`} height={14} />
          <SkeletonLine width={`${36 + (i % 2) * 10}%`} height={10} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTableRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="atp-skeleton-table" aria-hidden aria-busy="true">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="atp-skeleton-table-row">
          {Array.from({ length: cols }, (_, c) => (
            <SkeletonLine
              key={c}
              width={c === 0 ? "28%" : c === cols - 1 ? "18%" : "100%"}
              height={11}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCodeBlock({ lines = 8 }: { lines?: number }) {
  const widths = ["72%", "88%", "54%", "91%", "48%", "76%", "64%", "40%"];
  return (
    <div className="atp-skeleton-code" aria-hidden aria-busy="true">
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine key={i} width={widths[i % widths.length]} height={10} />
      ))}
    </div>
  );
}

export function SkeletonKpiRow({ count = 4 }: { count?: number }) {
  return (
    <div className="atp-skeleton-kpi-row" aria-hidden aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="atp-skeleton-kpi">
          <SkeletonLine width="56%" height={10} />
          <SkeletonLine width="72%" height={18} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonDetailPanel() {
  return (
    <div className="atp-skeleton-detail" aria-hidden aria-busy="true">
      <SkeletonKpiRow count={3} />
      <SkeletonCodeBlock lines={10} />
    </div>
  );
}