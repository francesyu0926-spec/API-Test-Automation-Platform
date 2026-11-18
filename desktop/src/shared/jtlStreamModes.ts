import type { JtlStreamAggregateOptions } from "./jtlStreamAggregator";

export type JtlStreamModeId = "fast" | "standard" | "deep";

export type JtlStreamModeDef = {
  id: JtlStreamModeId;
  label: string;
  limitLabel: string;
  hint: string;
  useCase: string;
  options: JtlStreamAggregateOptions;
};

export const JTL_STREAM_MODES: JtlStreamModeDef[] = [
  {
    id: "fast",
    label: "极速模式",
    limitLabel: "限额 800",
    hint: "秒开，仅看宏观指标与关键错误",
    useCase: "日常高频压测、CI/CD 跑完扫一眼",
    options: {
      maxArchiveSamples: 800,
      maxPreviewSamples: 800,
      maxDurationsPerLabel: 800,
    },
  },
  {
    id: "standard",
    label: "标准模式",
    limitLabel: "限额 5000",
    hint: "性能与细节平衡，可看较完整分布",
    useCase: "分析失败波动、状态码趋势",
    options: {
      maxArchiveSamples: 800,
      maxPreviewSamples: 5_000,
      maxDurationsPerLabel: 5_000,
    },
  },
  {
    id: "deep",
    label: "深度模式",
    limitLabel: "限额 50000",
    hint: "大样本蓄水池，略慢，极端场景",
    useCase: "长时间稳定性压测（GB 级 JTL）",
    options: {
      maxArchiveSamples: 800,
      maxPreviewSamples: 5_000,
      maxDurationsPerLabel: 50_000,
    },
  },
];

export const DEFAULT_JTL_STREAM_MODE: JtlStreamModeId = "fast";

/** 超过该体积的 JTL 自动按极速模式解析（流式读盘，避免长时间蓄水池计算） */
export const JTL_HUGE_FILE_BYTES = 500 * 1024 * 1024;

export function resolveJtlModeForFileSize(
  sizeBytes: number | null | undefined,
  preferred: JtlStreamModeId,
): { mode: JtlStreamModeId; forcedFast: boolean } {
  if (sizeBytes != null && sizeBytes > JTL_HUGE_FILE_BYTES) {
    return { mode: "fast", forcedFast: preferred !== "fast" };
  }
  return { mode: preferred, forcedFast: false };
}

export function resolveJtlStreamMode(id?: string | null): JtlStreamModeDef {
  const hit = JTL_STREAM_MODES.find((m) => m.id === id);
  return hit ?? JTL_STREAM_MODES[0];
}

export function jtlStreamOptionsForMode(id?: string | null): JtlStreamAggregateOptions {
  return resolveJtlStreamMode(id).options;
}