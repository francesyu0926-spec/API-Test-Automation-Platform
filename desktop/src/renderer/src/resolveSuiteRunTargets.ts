import { savedRequestToDraft } from "./apiWorkbenchModel";
import { suggestedCaseNameFromUrl, workbenchDraftToCaseYaml } from "./caseYaml";

export type SuiteRunTarget = Awaited<
  ReturnType<typeof window.atp.listSuiteRunTargets>
>["targets"][number];

/** 将套件运行目标解析为可执行的 case 文件名；集合请求会先写入 cases 并加入套件。 */
export async function resolveSuiteRunCaseIds(
  projectId: string,
  suiteName: string,
  targets: SuiteRunTarget[],
): Promise<string[]> {
  const caseIds: string[] = [];
  for (const target of targets) {
    if (target.kind === "case") {
      caseIds.push(target.id);
      continue;
    }
    const col = await window.atp.getCollection(projectId, target.collectionId);
    const req = col?.requests.find((r) => r.id === target.requestId);
    if (!req) continue;
    const draft = savedRequestToDraft(req);
    draft.name = target.label;
    let yaml = workbenchDraftToCaseYaml(draft);
    if (target.label.trim()) {
      yaml = yaml.replace(
        "description: 由 API 工作台生成",
        `description: ${target.label.trim().replace(/\n/g, " ")}`,
      );
    }
    const stem = suggestedCaseNameFromUrl(req.url);
    const res = await window.atp.saveProjectCase(projectId, stem, yaml, {
      addToSuite: suiteName,
      overwrite: true,
    });
    if (res.ok && res.caseName) caseIds.push(res.caseName);
  }
  return caseIds;
}