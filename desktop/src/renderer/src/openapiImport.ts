import yaml from "js-yaml";

import type { KeyValueRow, SavedApiRequest } from "../../shared/apiWorkbenchTypes";
import { savedRequestToDraft } from "./apiWorkbenchModel";
import {
  caseStemFromOpenApiOperation,
  workbenchDraftCaseStem,
  workbenchDraftToCaseYaml,
} from "./caseYaml";
import { previewProjectId } from "./projectIdPreview";

const OPENAPI_PICK_DEFAULT = "C:\\Users\\Administrator\\Desktop\\默认模块.openapi.json";
const OPENAPI_CASE_SUITE = "smoke";
const OPENAPI_CASE_DESCRIPTION = "由 OpenAPI 导入";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

type OpenApiParameter = {
  name?: string;
  in?: string;
  example?: unknown;
  schema?: { default?: unknown; example?: unknown };
};

type OpenApiOperation = {
  summary?: string;
  operationId?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, { example?: unknown; examples?: Record<string, { value?: unknown }> }>;
  };
};

export type ParsedOpenApi = {
  info: { title: string; version?: string };
  baseUrl: string;
  suggestedProjectId: string;
  collectionName: string;
  requests: SavedApiRequest[];
  warnings: string[];
};

function parseSpecText(text: string): unknown {
  const raw = text.trim();
  if (!raw) throw new Error("empty");
  if (raw.startsWith("{")) return JSON.parse(raw) as unknown;
  return yaml.load(raw) as unknown;
}

function paramValue(p: OpenApiParameter): string {
  const v = p.example ?? p.schema?.example ?? p.schema?.default;
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function pickRequestBodyExample(
  content?: Record<string, { example?: unknown; examples?: Record<string, { value?: unknown }> }>,
): { body: string; contentType?: string } {
  if (!content) return { body: "" };
  const prefer = ["application/json", "application/*+json", "text/plain"];
  const keys = Object.keys(content);
  const key = prefer.find((k) => keys.includes(k)) ?? keys[0];
  if (!key) return { body: "" };
  const slot = content[key];
  let example = slot?.example;
  if (example === undefined && slot?.examples) {
    const first = Object.values(slot.examples)[0];
    example = first?.value;
  }
  if (example === undefined) return { body: "", contentType: key };
  const body = typeof example === "string" ? example : JSON.stringify(example, null, 2);
  return { body, contentType: key };
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `openapi-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildUrl(pathTemplate: string, useBaseUrlVar: boolean, serverPrefix: string): string {
  const path = pathTemplate.startsWith("/") ? pathTemplate : `/${pathTemplate}`;
  if (useBaseUrlVar) return `{{base_url}}${path}`;
  const base = serverPrefix.replace(/\/+$/, "");
  return `${base}${path}`;
}

function substitutePathParams(path: string, params: OpenApiParameter[]): string {
  let out = path;
  for (const p of params) {
    if (p.in !== "path" || !p.name) continue;
    const val = encodeURIComponent(paramValue(p) || `{${p.name}}`);
    out = out.replace(new RegExp(`\\{${p.name}\\}`, "g"), val);
  }
  return out;
}

export function parseOpenApiDocument(
  raw: string,
  opts?: { fileName?: string },
): { ok: true; data: ParsedOpenApi } | { ok: false; error: string } {
  let doc: Record<string, unknown>;
  try {
    doc = parseSpecText(raw) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "OpenAPI 文件不是有效的 JSON / YAML" };
  }

  const openapi = String(doc.openapi ?? doc.swagger ?? "");
  if (!openapi) {
    return { ok: false, error: "缺少 openapi / swagger 版本字段" };
  }

  const info = (doc.info ?? {}) as { title?: string; version?: string };
  const title = info.title?.trim() || opts?.fileName?.replace(/\.[^.]+$/, "") || "openapi-import";
  const servers = (doc.servers ?? []) as Array<{ url?: string }>;
  const serverUrl = servers[0]?.url?.trim() ?? "";
  const useBaseUrlVar = !serverUrl;
  const baseUrl = useBaseUrlVar ? "https://api.example.com" : serverUrl.replace(/\/+$/, "");

  const paths = (doc.paths ?? {}) as Record<string, Record<string, OpenApiOperation>>;
  const requests: SavedApiRequest[] = [];
  const warnings: string[] = [];

  for (const [pathTemplate, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue;
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      if (!op || typeof op !== "object") continue;
      const parameters = op.parameters ?? [];
      const pathResolved = substitutePathParams(pathTemplate, parameters);
      const query: KeyValueRow[] = [];
      const headers: KeyValueRow[] = [];
      for (const p of parameters) {
        if (!p.name || !p.in) continue;
        const row: KeyValueRow = { key: p.name, value: paramValue(p), enabled: true };
        if (p.in === "query") query.push(row);
        else if (p.in === "header") headers.push(row);
      }

      const { body, contentType } = pickRequestBodyExample(op.requestBody?.content);
      const hasBody = method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD" && body.trim();

      const name =
        op.summary?.trim() ||
        op.operationId?.trim() ||
        `${method.toUpperCase()} ${pathTemplate}`.slice(0, 80);

      const caseStem = caseStemFromOpenApiOperation({
        operationId: op.operationId,
        method: method.toUpperCase(),
        pathTemplate,
      });

      requests.push({
        id: newRequestId(),
        name,
        caseStem,
        folder: "OpenAPI",
        method: method.toUpperCase(),
        url: buildUrl(pathResolved, useBaseUrlVar, serverUrl),
        headers,
        query,
        bodyMode: hasBody ? "raw" : "none",
        body: hasBody ? body : "",
        bodyContentType: hasBody ? contentType ?? "application/json" : undefined,
      });
    }
  }

  if (!requests.length) {
    return { ok: false, error: "未在 paths 中解析到任何 HTTP 接口" };
  }

  const fromTitle = previewProjectId(title);
  const suggestedProjectId =
    fromTitle || previewProjectId(opts?.fileName?.replace(/\.[^.]+$/, "") ?? "") || "openapi-import";

  if (!serverUrl) {
    warnings.push("规范未包含 servers，请求 URL 使用 {{base_url}}+路径，请在 dev 环境填写 base_url。");
  }

  return {
    ok: true,
    data: {
      info: { title, version: info.version },
      baseUrl,
      suggestedProjectId,
      collectionName: title,
      requests,
      warnings,
    },
  };
}

async function pickUniqueCaseName(
  projectId: string,
  base: string,
  used: Set<string>,
): Promise<string> {
  const root = base.trim() || "openapi-case";
  let candidate = root;
  let n = 2;
  while (used.has(candidate) || (await window.atp.projectCaseExists(projectId, candidate))) {
    candidate = `${root}-${n}`;
    n += 1;
    if (n > 500) return `${root}-${Date.now()}`;
  }
  used.add(candidate);
  return candidate;
}

function caseYamlFromOpenApiRequest(req: SavedApiRequest): string {
  const draft = savedRequestToDraft(req);
  const displayName = req.name?.trim() || req.caseStem || "openapi-case";
  return workbenchDraftToCaseYaml(draft, undefined, { displayName }).replace(
    "description: 由 API 工作台生成",
    `description: ${OPENAPI_CASE_DESCRIPTION}`,
  );
}

export async function syncOpenApiRequestsToProjectCases(
  projectId: string,
  requests: SavedApiRequest[],
): Promise<{ saved: number; failed: string[] }> {
  const used = new Set<string>();
  const failed: string[] = [];
  let saved = 0;

  for (const req of requests) {
    const draft = savedRequestToDraft(req);
    const stemBase = req.caseStem?.trim() || workbenchDraftCaseStem(draft);
    const caseName = await pickUniqueCaseName(projectId, stemBase, used);
    const yaml = caseYamlFromOpenApiRequest(req);
    const res = await window.atp.saveProjectCase(projectId, caseName, yaml, {
      addToSuite: OPENAPI_CASE_SUITE,
      overwrite: false,
    });
    if (res.ok) {
      saved += 1;
    } else {
      failed.push(req.name?.trim() || caseName);
    }
  }

  return { saved, failed };
}

/** 将集合中尚未有 YAML 的请求补写入 cases（侧栏刷新 / 修复导入后列表不同步） */
export async function backfillProjectCasesFromCollections(
  projectId: string,
): Promise<{ saved: number; failed: string[] }> {
  const cols = await window.atp.listCollections(projectId);
  const missing: SavedApiRequest[] = [];
  for (const c of cols) {
    const doc = await window.atp.getCollection(projectId, c.id);
    for (const r of doc?.requests ?? []) {
      const draft = savedRequestToDraft(r);
      const stem = r.caseStem?.trim() || workbenchDraftCaseStem(draft);
      if (!stem) continue;
      if (await window.atp.projectCaseExists(projectId, stem)) continue;
      missing.push(r);
    }
  }
  if (!missing.length) return { saved: 0, failed: [] };
  return syncOpenApiRequestsToProjectCases(projectId, missing);
}

export async function applyOpenApiImportToRepo(opts: {
  projectId: string;
  projectName: string;
  baseUrl: string;
  collectionId: string;
  collectionName: string;
  requests: SavedApiRequest[];
}): Promise<{
  ok: boolean;
  error?: string;
  projectId?: string;
  casesSaved?: number;
  casesFailed?: string[];
}> {
  const id = previewProjectId(opts.projectId) || opts.projectId;
  if (!id) return { ok: false, error: "项目 ID 无效" };

  const created = await window.atp.createProject({
    id,
    name: opts.projectName || id,
    baseUrl: opts.baseUrl.trim() || "https://api.example.com",
  });
  if (!created.ok) {
    return { ok: false, error: created.error ?? "创建项目失败" };
  }
  const projectId = created.projectId ?? id;

  const colId = previewProjectId(opts.collectionId) || "openapi";
  await window.atp.ensureCollection(projectId, colId);
  const existing = await window.atp.getCollection(projectId, colId);
  const folders = new Set(existing?.folders ?? []);
  folders.add("OpenAPI");

  const collection = {
    id: colId,
    name: opts.collectionName || colId,
    folders: [...folders],
    requests: opts.requests,
  };
  const saved = await window.atp.saveCollection(projectId, collection);
  if (!saved.ok) {
    return { ok: false, error: "保存集合失败", projectId };
  }

  const caseOutcome = await syncOpenApiRequestsToProjectCases(projectId, opts.requests);
  return {
    ok: true,
    projectId,
    casesSaved: caseOutcome.saved,
    casesFailed: caseOutcome.failed,
  };
}

export type OpenApiPickResult =
  | { ok: true; data: ParsedOpenApi; filePath: string; fileName: string }
  | { ok: false; cancelled?: boolean; error?: string };

export async function pickAndParseOpenApiFile(): Promise<OpenApiPickResult> {
  const picked = await window.atp.pickOpenFile({
    defaultPath: OPENAPI_PICK_DEFAULT,
    filters: [
      { name: "OpenAPI", extensions: ["json", "yaml", "yml"] },
      { name: "JSON", extensions: ["json"] },
    ],
  });
  if (picked.cancelled || !picked.filePath) return { ok: false, cancelled: true };
  const text = await window.atp.readAbsoluteFile(picked.filePath);
  if (!text?.trim()) return { ok: false, error: "无法读取所选文件" };
  const slash = Math.max(picked.filePath.lastIndexOf("\\"), picked.filePath.lastIndexOf("/"));
  const fileName = slash >= 0 ? picked.filePath.slice(slash + 1) : picked.filePath;
  const parsed = parseOpenApiDocument(text, { fileName });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, data: parsed.data, filePath: picked.filePath, fileName };
}