import { parseJtlCsv } from "../../shared/jtl";
import { jtlToRunBenchmarkReport } from "./jtlAnalytics";

export async function archiveJmeterJtlToPerf(
  projectId: string,
  jtlPath: string,
  jmxPath?: string,
): Promise<{ ok: boolean; error?: string; relativePath?: string }> {
  if (!projectId?.trim()) return { ok: false, error: "未选择项目" };
  const p = jtlPath.trim();
  if (!p) return { ok: false, error: "JTL 路径为空" };

  const text = await window.atp.readAbsoluteFile(p);
  if (text == null) return { ok: false, error: "无法读取 JTL 文件" };

  const parsed = parseJtlCsv(text);
  const report = jtlToRunBenchmarkReport(parsed.samples, { sourceJtl: p, jmxPath });
  if (!report) {
    return { ok: false, error: "JTL 中无有效 HTTP 样本，未写入历史" };
  }

  const res = await window.atp.savePerfReport(projectId, report);
  if (!res.ok) return { ok: false, error: "保存失败" };
  return { ok: true, relativePath: res.relativePath };
}