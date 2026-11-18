/** 与主进程 createProject 的目录 ID 规则一致（仅用于界面预览） */
export function previewProjectId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}