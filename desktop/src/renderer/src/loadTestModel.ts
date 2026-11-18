import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import { defaultDraft } from "./apiWorkbenchModel";

export type LoadTestThreadGroup = {
  threads: number;
  rampUpSec: number;
  loops: number;
  warmup: number;
  timeoutMs: number;
};

export type LoadTestPlan = {
  planName: string;
  threadGroup: LoadTestThreadGroup;
  sampler: WorkbenchDraft;
  /** 来自集合的请求 id，仅用于 UI 高亮 */
  sourceRequestId?: string | null;
  sourceCollectionId?: string | null;
};

export type LoadTestConfigNode = "plan" | "threadGroup" | "httpSampler";

/** 顶栏主视图：左侧树仅用于 config */
export type LoadTestMainTab = "config" | "report" | "history" | "jmeterRun" | "jmeterJtl";

export type LoadTestTreeNode =
  | LoadTestConfigNode
  | "aggregateReport"
  | "jmeterRun"
  | "jmeterJtl";

export function defaultLoadTestPlan(): LoadTestPlan {
  return {
    planName: "测试计划",
    threadGroup: {
      threads: 10,
      rampUpSec: 5,
      loops: 1,
      warmup: 0,
      timeoutMs: 30_000,
    },
    sampler: defaultDraft(),
  };
}

export function threadGroupToBenchmarkOpts(tg: LoadTestThreadGroup) {
  return {
    concurrency: tg.threads,
    loops: tg.loops,
    rampUpSec: tg.rampUpSec,
    warmup: tg.warmup,
    timeoutMs: tg.timeoutMs,
  };
}