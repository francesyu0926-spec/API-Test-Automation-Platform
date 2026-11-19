import type { SavedApiRequest } from "../../shared/apiWorkbenchTypes";
import { buildUrl, savedRequestToDraft } from "./apiWorkbenchModel";
import { workbenchDraftCaseStem } from "./caseYaml";

export const CASE_REQUEST_ID_PREFIX = "case:";

function requestPathForMatch(url: string): string {
  const path = url
    .trim()
    .toLowerCase()
    .replace(/^\{\{[^}]+\}\}/i, "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .split("?")[0]
    .replace(/\/+$/, "");
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

/** 与 main/atpService.suiteRequestFingerprint 一致 */
export function suiteRequestFingerprint(method: string, url: string): string {
  return `${method.trim().toUpperCase()} ${requestPathForMatch(url)}`;
}

export type CollectionListRow = {
  collectionId: string;
  collectionName: string;
  request: SavedApiRequest;
};

/** 项目与用例 · 集合列表：去掉已有 YAML、case: 镜像及同 URL 重复项 */
export function dedupeProjectCollectionRows(
  rows: CollectionListRow[],
  yamlCaseIds: string[],
  yamlRequestFingerprints: Set<string>,
): CollectionListRow[] {
  const caseIdSet = new Set(yamlCaseIds);
  const seenFp = new Set<string>();
  const out: CollectionListRow[] = [];

  for (const row of rows) {
    const req = row.request;
    if (req.id.startsWith(CASE_REQUEST_ID_PREFIX)) {
      const caseId = req.id.slice(CASE_REQUEST_ID_PREFIX.length);
      if (caseIdSet.has(caseId)) continue;
    }
    const stem = req.caseStem?.trim() || workbenchDraftCaseStem(savedRequestToDraft(req));
    if (stem && caseIdSet.has(stem)) continue;

    const fp = suiteRequestFingerprint(req.method, buildUrl(req.url, req.query));
    if (yamlRequestFingerprints.has(fp)) continue;
    if (seenFp.has(fp)) continue;
    seenFp.add(fp);
    out.push(row);
  }
  return out;
}