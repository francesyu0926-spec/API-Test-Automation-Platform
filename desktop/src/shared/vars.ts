import type { WorkbenchDraft } from "./apiWorkbenchTypes";

const VAR_RE = /\{\{(\w+)\}\}/g;

export function substituteVars(text: string, variables: Record<string, string>): string {
  return text.replace(VAR_RE, (_, key: string) => {
    if (!(key in variables)) {
      throw new Error(`未定义变量: {{${key}}}（点「配置变量」或编辑 environments/*.local.yaml）`);
    }
    return variables[key]!;
  });
}

/** 仅替换已配置的变量，其余 {{var}} 保留 */
export function partialSubstitute(text: string, variables: Record<string, string>): string {
  return text.replace(VAR_RE, (full, key: string) =>
    key in variables ? variables[key]! : full,
  );
}

export function applyDefinedVariablesToDraft(
  draft: WorkbenchDraft,
  variables: Record<string, string>,
): WorkbenchDraft {
  const sub = (t: string) => partialSubstitute(t, variables);
  return {
    ...draft,
    url: sub(draft.url),
    query: draft.query.map((r) => ({ ...r, value: sub(r.value) })),
    headers: draft.headers.map((h) => ({ ...h, value: sub(h.value) })),
    body: sub(draft.body),
  };
}

export function findUndefinedVars(text: string, variables: Record<string, string>): string[] {
  const missing = new Set<string>();
  for (const m of text.matchAll(VAR_RE)) {
    const key = m[1];
    if (key && !(key in variables)) missing.add(key);
  }
  return [...missing];
}

export function templateVarNamesInDraft(draft: {
  url: string;
  query: { value: string }[];
  headers: { value: string }[];
  body: string;
}): string[] {
  const blobs = [
    draft.url,
    draft.body,
    ...draft.query.map((q) => q.value),
    ...draft.headers.map((h) => h.value),
  ];
  const keys = new Set<string>();
  for (const text of blobs) {
    for (const m of text.matchAll(VAR_RE)) {
      if (m[1]) keys.add(m[1]);
    }
  }
  return [...keys];
}

/** 请求模板中引用但环境未配置或值为空的变量 */
export function findUnresolvedTemplateVars(
  draft: {
    url: string;
    query: { value: string }[];
    headers: { value: string }[];
    body: string;
  },
  variables: Record<string, string>,
): string[] {
  return templateVarNamesInDraft(draft).filter((name) => {
    if (!(name in variables)) return true;
    return !String(variables[name] ?? "").trim();
  });
}