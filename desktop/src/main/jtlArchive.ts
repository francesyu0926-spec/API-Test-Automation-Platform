import type { HttpBenchmarkReport } from "../shared/apiWorkbenchTypes";
import { jtlAggregateToRunBenchmarkReport } from "../shared/jtlArchiveFromAggregate";
import { findJmxFilesNearJtl } from "./projectFs";
import * as perfReports from "./perfReportStore";
import fsp from "node:fs/promises";

import { resolveJtlModeForFileSize, type JtlStreamModeId } from "../shared/jtlStreamModes";
import { aggregateJtlFile } from "./jtlStreamParse";

export async function archiveJtlFileToPerf(
  projectId: string,
  jtlPath: string,
  jmxPath?: string,
  mode?: JtlStreamModeId | null,
): Promise<{ ok: boolean; error?: string; relativePath?: string; report?: HttpBenchmarkReport }> {
  const p = jtlPath.trim();
  if (!projectId?.trim()) return { ok: false, error: "未选择项目" };
  if (!p) return { ok: false, error: "JTL 路径为空" };

  let agg;
  try {
    let size: number | null = null;
    try {
      size = (await fsp.stat(p)).size;
    } catch {
      /* ignore */
    }
    const { mode: resolvedMode } = resolveJtlModeForFileSize(size, mode ?? "fast");
    agg = await aggregateJtlFile(p, resolvedMode);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "读取 JTL 失败" };
  }

  if (agg.httpSampleCount === 0) {
    const hint = agg.errors[0] ?? "JTL 中无有效 HTTP 样本";
    return { ok: false, error: `${hint}，未写入历史` };
  }

  let resolvedJmx = jmxPath?.trim();
  if (!resolvedJmx) {
    const near = await findJmxFilesNearJtl(p);
    resolvedJmx = near[0];
  }

  const report = jtlAggregateToRunBenchmarkReport(agg, {
    sourceJtl: p,
    jmxPath: resolvedJmx,
    projectId,
  });
  if (!report) return { ok: false, error: "无法从 JTL 生成压测报告" };

  const saved = await perfReports.savePerfReport(projectId, report, undefined, null);
  if (!saved.ok) return { ok: false, error: saved.error ?? "保存失败" };
  return { ok: true, relativePath: saved.relativePath, report };
}