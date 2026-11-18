import type { ApiCollectionFile } from "../../shared/apiWorkbenchTypes";
import { draftToSavedRequest } from "./apiWorkbenchModel";
import { caseYamlToWorkbenchDraft } from "./caseYaml";

export const PROJECT_CASES_FOLDER = "项目用例";
export const CASE_REQUEST_ID_PREFIX = "case:";

export function caseRequestId(caseName: string): string {
  return `${CASE_REQUEST_ID_PREFIX}${caseName}`;
}

/** 将 projects 下 cases 目录中的 YAML 用例同步到工作台集合（新增/更新，移除已删用例条目） */
export async function importProjectCasesToCollection(
  projectId: string,
  caseNames: string[],
  collectionId = "default",
): Promise<{ ok: boolean; imported: number; removed: number; failed: string[] }> {
  if (!projectId.trim() || !caseNames.length) {
    return { ok: true, imported: 0, removed: 0, failed: [] };
  }

  const col = await window.atp.ensureCollection(projectId, collectionId);
  const wantedIds = new Set(caseNames.map(caseRequestId));
  const kept = col.requests.filter(
    (r) => !r.id.startsWith(CASE_REQUEST_ID_PREFIX) || wantedIds.has(r.id),
  );
  const removed = col.requests.length - kept.length;
  const byId = new Map(kept.map((r) => [r.id, r]));

  const folders = new Set(col.folders ?? []);
  folders.add(PROJECT_CASES_FOLDER);

  const failed: string[] = [];
  let imported = 0;

  for (const caseName of caseNames) {
    try {
      const text = await window.atp.readFile(`projects/${projectId}/cases/${caseName}.yaml`);
      if (!text?.trim()) {
        failed.push(caseName);
        continue;
      }
      const draft = caseYamlToWorkbenchDraft(text);
      if (!draft) {
        failed.push(caseName);
        continue;
      }
      draft.name = (draft.name?.trim() || caseName) as string;
      draft.folder = PROJECT_CASES_FOLDER;
      const id = caseRequestId(caseName);
      byId.set(id, draftToSavedRequest(id, draft));
      imported += 1;
    } catch {
      failed.push(caseName);
    }
  }

  const next: ApiCollectionFile = {
    ...col,
    folders: [...folders].sort((a, b) => a.localeCompare(b, "zh")),
    requests: [...byId.values()],
  };
  await window.atp.saveCollection(projectId, next);
  return { ok: true, imported, removed, failed };
}