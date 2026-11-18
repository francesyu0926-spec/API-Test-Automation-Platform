import type { PercentileApproxMeta } from "../../shared/jtlStreamAggregator";

export function formatReservoirLabel(n: number): string {
  if (n >= 10_000) {
    const wan = n / 10_000;
    return wan >= 10 ? `${Math.round(wan)}万` : `${wan.toFixed(1)}万`;
  }
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}千`;
  return String(n);
}

export function percentileApproxTooltip(meta: PercentileApproxMeta | null | undefined): string | null {
  if (!meta?.approximate) return null;
  const basis = formatReservoirLabel(meta.reservoirUsed);
  const total =
    meta.totalSamples > meta.reservoirUsed
      ? `（全量 ${formatReservoirLabel(meta.totalSamples)} 条，蓄水池上限 ${formatReservoirLabel(meta.cap)}）`
      : "";
  return `基于约 ${basis} 条样本的流式蓄水池计算${total}，与 JMeter 全量排序可能存在小幅差异，误差通常在可接受范围内。`;
}

type MarkProps = {
  meta?: PercentileApproxMeta | null;
  className?: string;
};

/** 表头 P90/P95/P99 旁的近似标注 */
export function PercentileApproxMark({ meta, className }: MarkProps) {
  const tip = percentileApproxTooltip(meta);
  if (!tip) return null;
  return (
    <span className={`percentile-approx-mark${className ? ` ${className}` : ""}`} title={tip} aria-label={tip}>
      <span aria-hidden className="percentile-approx-icon">
        ⓘ
      </span>
      <span className="percentile-approx-text">近似</span>
    </span>
  );
}

type ThProps = {
  label: string;
  meta?: PercentileApproxMeta | null;
};

export function PercentileTh({ label, meta }: ThProps) {
  return (
    <th className="num percentile-th">
      <span className="percentile-th-label">{label}</span>
      <PercentileApproxMark meta={meta} />
    </th>
  );
}