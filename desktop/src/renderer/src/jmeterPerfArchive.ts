import { resolvePerfArchiveProjectId } from "../../shared/perfProject";
import type { JtlStreamModeId } from "../../shared/jtlStreamModes";
import { loadPersistedJtlStreamMode } from "./jtlStreamModePrefs";

export async function archiveJmeterJtlToPerf(
  projectId: string,
  jtlPath: string,
  jmxPath?: string,
  mode?: JtlStreamModeId,
): Promise<{ ok: boolean; error?: string; relativePath?: string }> {
  const resolvedProject = resolvePerfArchiveProjectId(projectId);
  const p = jtlPath.trim();
  if (!p) return { ok: false, error: "JTL 路径为空" };
  const resolvedMode = mode ?? loadPersistedJtlStreamMode();

  return window.atp.archiveJtlToPerfFromFile(resolvedProject, p, jmxPath?.trim() || undefined, resolvedMode);
}