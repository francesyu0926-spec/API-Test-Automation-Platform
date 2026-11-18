import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import { inferBodyContentType } from "./apiWorkbenchModel";
import { buildJmxFromWorkbenchDrafts, type JmxExportOptions } from "./jmxExport";
import type { LoadTestPlan } from "./loadTestModel";

export function jmxOptionsFromLoadTestPlan(plan: LoadTestPlan, envName: string): JmxExportOptions {
  return {
    planName: plan.planName.trim() || "测试计划",
    threadGroupName: "线程组",
    threads: plan.threadGroup.threads,
    rampUpSec: plan.threadGroup.rampUpSec,
    loops: plan.threadGroup.loops,
    envName,
    injectEnv: true,
    includeAggregateListener: false,
  };
}

export function samplerLabelFromPlan(plan: LoadTestPlan, linkedRequestName?: string | null): string {
  return linkedRequestName || plan.sampler.name?.trim() || "HTTP 请求";
}

/** 集合导入后 bodyMode 可能不是 raw，导致 JMX 丢 Body */
export function prepareSamplerForJmx(draft: WorkbenchDraft): WorkbenchDraft {
  const method = draft.method.toUpperCase();
  const body = (draft.body ?? "").trim();
  if (method === "GET" || method === "HEAD" || !body) return draft;
  const bodyMode = draft.bodyMode === "raw" ? "raw" : "raw";
  const bodyContentType =
    draft.bodyContentType ?? inferBodyContentType(undefined, draft.body) ?? "application/json";
  return { ...draft, bodyMode, bodyContentType };
}

function siblingRunOutputDir(jmxAbsolutePath: string): string {
  const trimmed = jmxAbsolutePath.trim();
  const sep = trimmed.includes("\\") ? "\\" : "/";
  const last = trimmed.lastIndexOf(sep);
  const dir = last >= 0 ? trimmed.slice(0, last) : trimmed;
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${dir}${sep}run_${day}`;
}

export type LoadTestJmxWriteResult = {
  ok: boolean;
  absolutePath?: string;
  relativePath?: string;
  outputDir?: string;
  error?: string;
  warnings: string[];
};

export async function writeLoadTestPlanJmx(
  project: string,
  plan: LoadTestPlan,
  envName: string,
  variables: Record<string, string>,
  linkedRequestName?: string | null,
): Promise<LoadTestJmxWriteResult> {
  const sampler = prepareSamplerForJmx(plan.sampler);
  const label = samplerLabelFromPlan(plan, linkedRequestName);
  const built = buildJmxFromWorkbenchDrafts(
    [{ label, draft: sampler }],
    jmxOptionsFromLoadTestPlan(plan, envName),
    variables,
  );
  const warnings = [...built.warnings];
  if (built.errors.length && !built.xml) {
    return { ok: false, error: built.errors.join("；"), warnings };
  }
  if (!built.xml) {
    return { ok: false, error: "无法生成 JMX", warnings };
  }
  if (built.errors.length) {
    warnings.push(...built.errors);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const rel = `projects/${project}/jmx/loadtest-${stamp}.jmx`;
  const repo = await window.atp.writeRepoFile(rel, built.xml);
  if (!repo.ok || !repo.relativePath) {
    return { ok: false, error: repo.error ?? "写入 JMX 失败", warnings };
  }
  const absolutePath = repo.absolutePath?.trim();
  if (!absolutePath) {
    return { ok: false, error: "写入成功但未返回 JMX 绝对路径，请重启应用后重试", warnings };
  }
  return {
    ok: true,
    absolutePath,
    relativePath: repo.relativePath,
    outputDir: siblingRunOutputDir(absolutePath),
    warnings,
  };
}