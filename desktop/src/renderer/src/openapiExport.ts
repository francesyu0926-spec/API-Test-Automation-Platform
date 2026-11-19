import yaml from "js-yaml";

import type { SavedApiRequest, WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import { buildUrl, normalizeRawBodyDraft, rowsToRecord, savedRequestToDraft } from "./apiWorkbenchModel";
import { caseYamlToWorkbenchDraft, workbenchDraftCaseStem } from "./caseYaml";

export type OpenApiExportItem = {
  key: string;
  projectId: string;
  projectName: string;
  source: "yaml" | "collection";
  label: string;
  detail?: string;
  caseId?: string;
  collectionId?: string;
  requestId?: string;
  caseYaml?: string;
  request?: SavedApiRequest;
};

export type OpenApiExportOptions = {
  title: string;
  version: string;
  serverUrl: string;
  format: "json" | "yaml";
};

type OpenApiParameter = {
  name: string;
  in: "query" | "header" | "path";
  schema?: { type?: string; default?: string };
  example?: string;
};

type OpenApiOperation = {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content: Record<string, { example?: unknown }>;
  };
};

export async function loadOpenApiExportItems(
  projects: Array<{ id: string; name: string }>,
): Promise<OpenApiExportItem[]> {
  const out: OpenApiExportItem[] = [];
  for (const p of projects) {
    const assets = await window.atp.listProjectAssets(p.id);
    const caseIds = new Set(assets.cases);
    for (const caseId of assets.cases) {
      const text = assets.caseTexts[caseId] ?? "";
      let label = caseId;
      try {
        const doc = yaml.load(text) as { name?: string; description?: string };
        label = doc?.name?.trim() || doc?.description?.trim() || caseId;
      } catch {
        // keep stem
      }
      out.push({
        key: `${p.id}:yaml:${caseId}`,
        projectId: p.id,
        projectName: p.name,
        source: "yaml",
        label,
        detail: `YAML · ${caseId}`,
        caseId,
        caseYaml: text,
      });
    }
    const cols = await window.atp.listCollections(p.id);
    for (const c of cols) {
      const doc = await window.atp.getCollection(p.id, c.id);
      for (const req of doc?.requests ?? []) {
        if (req.id.startsWith("case:")) continue;
        const stem = req.caseStem?.trim() || workbenchDraftCaseStem(savedRequestToDraft(req));
        if (stem && caseIds.has(stem)) continue;
        out.push({
          key: `${p.id}:col:${c.id}:${req.id}`,
          projectId: p.id,
          projectName: p.name,
          source: "collection",
          label: req.name?.trim() || req.id,
          detail: `集合 · ${c.name ?? c.id}`,
          collectionId: c.id,
          requestId: req.id,
          request: req,
        });
      }
    }
  }
  return out;
}

function slugOperationId(raw: string): string {
  return raw
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function parseUrlParts(fullUrl: string, serverUrl: string): {
  path: string;
  query: Array<{ key: string; value: string }>;
  useTemplatedServer: boolean;
} {
  const trimmed = fullUrl.trim();
  const useTemplated = /\{\{base_url\}\}/i.test(trimmed);
  if (useTemplated) {
    const pathPart = trimmed.replace(/^\{\{base_url\}\}/i, "");
    const q = pathPart.indexOf("?");
    const pathOnly = (q >= 0 ? pathPart.slice(0, q) : pathPart).trim() || "/";
    const path = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
    const query: Array<{ key: string; value: string }> = [];
    if (q >= 0) {
      for (const pair of pathPart.slice(q + 1).split("&")) {
        if (!pair) continue;
        const eq = pair.indexOf("=");
        if (eq < 0) query.push({ key: decodeURIComponent(pair), value: "" });
        else {
          query.push({
            key: decodeURIComponent(pair.slice(0, eq)),
            value: decodeURIComponent(pair.slice(eq + 1)),
          });
        }
      }
    }
    return { path, query, useTemplatedServer: true };
  }
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    const server = serverUrl.replace(/\/+$/, "");
    const origin = u.origin.toLowerCase();
    const templated =
      !server || server === "https://api.example.com"
        ? false
        : origin === server.replace(/\/+$/, "").toLowerCase() || trimmed.startsWith(server);
    const query: Array<{ key: string; value: string }> = [];
    u.searchParams.forEach((value, key) => query.push({ key, value }));
    return {
      path: u.pathname || "/",
      query,
      useTemplatedServer: !templated,
    };
  } catch {
    return { path: "/", query: [], useTemplatedServer: false };
  }
}

const SKIP_HEADER_PARAMS = new Set([
  "accept",
  "accept-encoding",
  "connection",
  "content-length",
  "host",
  "user-agent",
]);

function draftToOperation(
  draft: WorkbenchDraft,
  meta: {
    projectId: string;
    projectName: string;
    summary: string;
    description?: string;
    operationId: string;
  },
  serverUrl: string,
): { path: string; method: string; operation: OpenApiOperation } | { error: string } {
  const method = draft.method.toLowerCase();
  if (!["get", "post", "put", "patch", "delete", "head", "options"].includes(method)) {
    return { error: `不支持的方法 ${draft.method}` };
  }
  const fullUrl = buildUrl(draft.url, draft.query);
  if (!fullUrl.trim()) return { error: "URL 为空" };
  const { path, query } = parseUrlParts(fullUrl, serverUrl);
  const parameters: OpenApiParameter[] = [];
  for (const row of query) {
    if (!row.key.trim()) continue;
    parameters.push({
      name: row.key.trim(),
      in: "query",
      schema: { type: "string" },
      example: row.value,
    });
  }
  const headerRecord = rowsToRecord(draft.headers);
  for (const [name, value] of Object.entries(headerRecord)) {
    if (SKIP_HEADER_PARAMS.has(name.toLowerCase())) continue;
    parameters.push({
      name,
      in: "header",
      schema: { type: "string" },
      example: value,
    });
  }

  const operation: OpenApiOperation = {
    tags: [meta.projectName || meta.projectId],
    summary: meta.summary,
    description: meta.description,
    operationId: slugOperationId(meta.operationId),
    parameters: parameters.length ? parameters : undefined,
  };

  if (draft.bodyMode === "raw" && draft.body.trim() && method !== "get" && method !== "head") {
    const contentType = draft.bodyContentType ?? "application/json";
    let example: unknown = draft.body;
    if (contentType.includes("json")) {
      try {
        example = JSON.parse(draft.body);
      } catch {
        example = draft.body;
      }
    }
    operation.requestBody = {
      content: {
        [contentType]: { example },
      },
    };
  }

  return { path, method, operation };
}

function itemToDraft(item: OpenApiExportItem): WorkbenchDraft | null {
  if (item.source === "yaml" && item.caseYaml?.trim()) {
    return caseYamlToWorkbenchDraft(item.caseYaml);
  }
  if (item.source === "collection" && item.request) {
    return normalizeRawBodyDraft(savedRequestToDraft(item.request));
  }
  return null;
}

export function buildOpenApiDocument(
  items: OpenApiExportItem[],
  selectedKeys: Set<string>,
  opts: OpenApiExportOptions,
): { ok: true; content: string; count: number; warnings: string[] } | { ok: false; error: string } {
  const picks = items.filter((i) => selectedKeys.has(i.key));
  if (!picks.length) return { ok: false, error: "请至少选择一条请求" };

  const paths: Record<string, Record<string, OpenApiOperation>> = {};
  const warnings: string[] = [];
  let count = 0;

  for (const item of picks) {
    const draft = itemToDraft(item);
    if (!draft) {
      warnings.push(`${item.projectName} / ${item.label}：无法解析`);
      continue;
    }
    const stem = workbenchDraftCaseStem(draft);
    const op = draftToOperation(draft, {
      projectId: item.projectId,
      projectName: item.projectName,
      summary: item.label,
      description: item.detail,
      operationId: `${item.projectId}_${stem}`,
    }, opts.serverUrl);
    if ("error" in op) {
      warnings.push(`${item.label}：${op.error}`);
      continue;
    }
    const slotKey = `${op.method.toUpperCase()} ${op.path}`;
    if (paths[op.path]?.[op.method]) {
      warnings.push(`${item.label}：与已有接口 ${slotKey} 重复，已跳过`);
      continue;
    }
    paths[op.path] = paths[op.path] ?? {};
    paths[op.path][op.method] = op.operation;
    count += 1;
  }

  if (!count) return { ok: false, error: warnings.join("；") || "没有可导出的 HTTP 接口" };

  const useTemplateServer = picks.some((item) => {
    const d = itemToDraft(item);
    if (!d) return false;
    const u = buildUrl(d.url, d.query);
    return /\{\{base_url\}\}/i.test(u);
  });

  const serverUrl = useTemplateServer
    ? opts.serverUrl.includes("{{")
      ? opts.serverUrl
      : "{{base_url}}"
    : opts.serverUrl.replace(/\/+$/, "") || "https://api.example.com";

  const doc = {
    openapi: "3.0.3",
    info: {
      title: opts.title.trim() || "API Test Platform Export",
      version: opts.version.trim() || "1.0.0",
    },
    servers: [{ url: serverUrl }],
    paths,
  };

  const content =
    opts.format === "yaml"
      ? yaml.dump(doc, { lineWidth: 120, noRefs: true })
      : JSON.stringify(doc, null, 2);

  return { ok: true, content, count, warnings };
}

export async function saveOpenApiExport(
  items: OpenApiExportItem[],
  selectedKeys: Set<string>,
  opts: OpenApiExportOptions,
): Promise<{ ok: boolean; error?: string; cancelled?: boolean; warnings?: string[] }> {
  const built = buildOpenApiDocument(items, selectedKeys, opts);
  if (!built.ok) return { ok: false, error: built.error };
  const ext = opts.format === "yaml" ? "yaml" : "json";
  const base = slugOperationId(opts.title) || "openapi-export";
  const res = await window.atp.saveTextWithDialog({
    defaultPath: `${base}.openapi.${ext}`,
    content: built.content,
    filters: [{ name: "OpenAPI", extensions: [ext] }],
  });
  if (res.cancelled) return { ok: false, cancelled: true };
  if (!res.ok) return { ok: false, error: res.error ?? "保存失败" };
  return { ok: true, warnings: built.warnings };
}