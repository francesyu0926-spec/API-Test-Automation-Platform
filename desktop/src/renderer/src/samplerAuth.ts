import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import { findUnresolvedTemplateVars } from "../../shared/vars";

function bearerTokenFromAuthorization(value: string): string | null {
  const m = value.trim().match(/^Bearer\s+(\S+)/i);
  return m?.[1] ?? null;
}

/** 本项目常见：JWT 写在 secret，Header token 使用 {{token}} */
function looksLikeJwt(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.includes("{{")) return false;
  return /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(v);
}

export function coalesceAuthVariables(variables: Record<string, string>): Record<string, string> {
  const out = { ...variables };
  const token = out.token?.trim() ?? "";
  const secret = out.secret?.trim() ?? "";
  if (!token && secret && looksLikeJwt(secret)) {
    out.token = secret;
  } else if (!secret && token && looksLikeJwt(token)) {
    out.secret = token;
  }
  if (!out.token?.trim() && out.authorization?.trim()) {
    const bearer = bearerTokenFromAuthorization(out.authorization);
    if (bearer) out.token = bearer;
  }
  if (!out.secret?.trim() && out.token?.trim() && looksLikeJwt(out.token)) {
    out.secret = out.token;
  }
  return out;
}

/** 发送请求时必须带字面量的鉴权头（与 jmxExport.mergeAuthHeaders 一致） */
export const AUTH_SEND_HEADER_KEYS = ["token", "secret", "terminalenv"] as const;

/** 将 token / secret / terminalenv 从环境并入最终请求头（覆盖未替换的 {{var}}） */
export function applyAuthHeadersFromEnv(
  headers: Record<string, string>,
  env: Record<string, string>,
): Record<string, string> {
  const auth = coalesceAuthVariables(env);
  const out = { ...headers };
  for (const key of AUTH_SEND_HEADER_KEYS) {
    const existingKey = Object.keys(out).find((k) => k.toLowerCase() === key);
    let value = existingKey ? String(out[existingKey]) : "";
    const trimmed = value.trim();
    if (!trimmed || /\{\{\w+\}\}/.test(trimmed)) {
      const fromEnv = auth[key]?.trim();
      if (fromEnv) value = fromEnv;
    } else {
      value = trimmed;
    }
    if (existingKey && existingKey !== key) delete out[existingKey];
    if (value.trim()) out[key] = value.trim();
  }
  return out;
}

/** Header 名 → 环境变量名（小写匹配 Header） */
const AUTH_HEADER_TO_VAR: Record<string, string> = {
  token: "token",
  secret: "secret",
  authorization: "authorization",
  terminalenv: "terminalenv",
};

/** 从请求头读取鉴权类明文，用于导入 cURL / 压测同步 */
export function authPatchFromSampler(sampler: WorkbenchDraft): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const row of sampler.headers) {
    if (!row.enabled || !row.key.trim()) continue;
    const varName = AUTH_HEADER_TO_VAR[row.key.trim().toLowerCase()];
    if (!varName) continue;
    const val = row.value?.trim() ?? "";
    if (!val || val.includes("{{")) continue;
    patch[varName] = val;
  }
  if (!patch.token && patch.authorization) {
    const bearer = bearerTokenFromAuthorization(patch.authorization);
    if (bearer) patch.token = bearer;
  }
  return patch;
}

/** 将 token / secret 等头改为 {{变量}}，避免明文落在集合里 */
export function templatizeAuthHeaders(draft: WorkbenchDraft): WorkbenchDraft {
  const patch = authPatchFromSampler(draft);
  if (!Object.keys(patch).length) return draft;
  const headers = draft.headers.map((row) => {
    if (!row.enabled || !row.key.trim()) return row;
    const varName = AUTH_HEADER_TO_VAR[row.key.trim().toLowerCase()];
    if (!varName || !patch[varName]) return row;
    const val = row.value?.trim() ?? "";
    if (val && !val.includes("{{")) {
      return { ...row, value: `{{${varName}}}` };
    }
    return row;
  });
  return { ...draft, headers };
}

export async function applyImportedCurlAuth(
  project: string,
  envName: string,
  draft: WorkbenchDraft,
): Promise<{ draft: WorkbenchDraft; savedKeys: string[] }> {
  const patch = authPatchFromSampler(draft);
  const templated = templatizeAuthHeaders(draft);
  if (!project?.trim() || !envName?.trim() || !Object.keys(patch).length) {
    return { draft: templated, savedKeys: [] };
  }
  await persistEnvVariables(project, envName, patch);
  return { draft: templated, savedKeys: Object.keys(patch) };
}

/** 将 Header 中已填写的鉴权头并入变量表（不覆盖已有的非空变量） */
export function mergeAuthFromSampler(
  variables: Record<string, string>,
  sampler: WorkbenchDraft,
): Record<string, string> {
  const out = { ...variables };
  const patch = authPatchFromSampler(sampler);
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k]?.trim();
    if (!cur) out[k] = v;
  }
  if (!out.token?.trim() && out.authorization?.trim()) {
    const bearer = bearerTokenFromAuthorization(out.authorization);
    if (bearer) out.token = bearer;
  }
  return coalesceAuthVariables(out);
}

type CaptureHeaders = { request?: { headers?: Record<string, string> } };

/** 抓包事务中的鉴权头 → 环境变量（保存用例时写入 *.local.yaml，避免工作台再配一遍） */
export function authPatchFromCaptureTx(tx: unknown): Record<string, string> {
  const headers = (tx as CaptureHeaders).request?.headers ?? {};
  const patch: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const varName = AUTH_HEADER_TO_VAR[k.trim().toLowerCase()];
    if (!varName) continue;
    const val = String(v ?? "").trim();
    if (!val || val.includes("{{")) continue;
    patch[varName] = val;
  }
  return patch;
}

export async function persistCaseAuthFromCapture(
  project: string,
  envName: string,
  tx: unknown,
): Promise<string[]> {
  const patch = authPatchFromCaptureTx(tx);
  if (!project.trim() || !envName.trim() || !Object.keys(patch).length) return [];
  await persistEnvVariables(project, envName, patch);
  return Object.keys(patch);
}

export function unresolvedWorkbenchVars(
  draft: WorkbenchDraft,
  variables: Record<string, string>,
): string[] {
  return findUnresolvedTemplateVars(draft, mergeAuthFromSampler(variables, draft));
}

export async function persistEnvVariables(
  project: string,
  envName: string,
  patch: Record<string, string>,
): Promise<void> {
  const current = await window.atp.getProjectVariables(project, envName);
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(current)) {
    if (k === "project") continue;
    merged[k] = v;
  }
  for (const [k, v] of Object.entries(patch)) {
    if (!k.trim() || k === "project") continue;
    if (v.trim()) merged[k.trim()] = v;
  }
  await window.atp.saveProjectEnvLocal(project, envName, merged);
}