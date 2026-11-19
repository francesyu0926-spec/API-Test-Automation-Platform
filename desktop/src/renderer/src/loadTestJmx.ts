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
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${dir}${sep}run_${stamp}`;
}

export type LoadTestJmxWriteResult = {
  ok: boolean;
  absolutePath?: string;
  relativePath?: string;
  outputDir?: string;
  xml?: string;
  suggestedFileName?: string;
  error?: string;
  warnings: string[];
};

function jmxFileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export function buildLoadTestPlanJmx(
  plan: LoadTestPlan,
  envName: string,
  variables: Record<string, string>,
  linkedRequestName?: string | null,
): Pick<LoadTestJmxWriteResult, "ok" | "xml" | "suggestedFileName" | "error" | "warnings"> {
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
  const stamp = jmxFileStamp();
  return {
    ok: true,
    xml: built.xml,
    suggestedFileName: `loadtest-${stamp}.jmx`,
    warnings,
  };
}

export async function saveLoadTestJmxWithDialog(
  xml: string,
  suggestedFileName: string,
): Promise<{ ok: boolean; filePath?: string; cancelled?: boolean; error?: string }> {
  return window.atp.saveTextWithDialog({
    defaultPath: suggestedFileName,
    content: xml,
    filters: [{ name: "JMeter 测试计划", extensions: ["jmx"] }],
  });
}

export async function writeLoadTestPlanJmx(
  project: string,
  plan: LoadTestPlan,
  envName: string,
  variables: Record<string, string>,
  linkedRequestName?: string | null,
): Promise<LoadTestJmxWriteResult> {
  const built = buildLoadTestPlanJmx(plan, envName, variables, linkedRequestName);
  if (!built.ok || !built.xml) {
    return {
      ok: false,
      error: built.error ?? "无法生成 JMX",
      warnings: built.warnings,
    };
  }
  const warnings = built.warnings;
  const rel = `projects/${project}/jmx/${built.suggestedFileName ?? `loadtest-${jmxFileStamp()}.jmx`}`;
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
    xml: built.xml,
    suggestedFileName: built.suggestedFileName,
    warnings,
  };
}