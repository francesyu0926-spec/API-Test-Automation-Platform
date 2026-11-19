import { suggestedCaseNameFromUrl } from "./caseYaml";

export type BatchCaseRow = {
  txId: string;
  method: string;
  path: string;
  url: string;
  caseName: string;
  /** 保存前可编辑的用例 YAML */
  yaml: string;
};

export function buildBatchCaseRows(
  rows: { id: string; method: string; path: string; url: string }[],
): BatchCaseRow[] {
  const used = new Set<string>();
  return rows.map((t) => {
    let base = suggestedCaseNameFromUrl(t.url);
    let name = base;
    let n = 2;
    while (used.has(name)) {
      name = `${base}-${n}`;
      n += 1;
    }
    used.add(name);
    return { txId: t.id, method: t.method, path: t.path, url: t.url, caseName: name, yaml: "" };
  });
}