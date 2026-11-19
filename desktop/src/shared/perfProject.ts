/** 直接导入 JMX 执行、未选工作区项目时的压测历史归属目录 */
export const PERF_OTHER_PROJECT_ID = "_other";
export const PERF_OTHER_PROJECT_LABEL = "其他";

export function resolvePerfArchiveProjectId(projectId: string | undefined | null): string {
  const t = (projectId ?? "").trim();
  return t || PERF_OTHER_PROJECT_ID;
}

export function perfArchiveProjectLabel(
  projectId: string,
  nameById?: Record<string, string>,
): string {
  if (!projectId || projectId === PERF_OTHER_PROJECT_ID) return PERF_OTHER_PROJECT_LABEL;
  return nameById?.[projectId] ?? projectId;
}