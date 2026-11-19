import yaml from "js-yaml";

import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import {
  buildUrl,
  emptyRow,
  headersForSend,
  headersToRows,
  normalizeRawBodyDraft,
  promoteQueryAuthToHeaders,
  splitUrlAndQuery,
} from "./apiWorkbenchModel";

const SKIP_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "proxy-connection",
  "accept-encoding",
]);

const SENSITIVE_HEADER = /^(token|authorization|cookie|x-access-token)$/i;

type CaptureTx = {
  request?: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown };
  response?: { status?: number };
};

function slugCaseName(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 48) || "captured-case";
}

export function suggestedCaseNameFromUrl(url: string): string {
  return caseNameFromUrl(url);
}

function pathTailStem(pathPart: string): string {
  const last = pathPart.split("/").filter(Boolean).pop() ?? "";
  const cleaned = last.replace(/\{[^}]+\}/g, "");
  const stem = slugCaseName(cleaned);
  return stem !== "captured-case" ? stem : "";
}

/** 从含 {{base_url}}、相对路径或完整 URL 提取路径末段作为用例 stem */
export function caseNameFromTemplatedUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "captured-case";
  try {
    const u = new URL(trimmed);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1]?.replace(/\{[^}]+\}/g, "") ?? "";
    const stem = slugCaseName(last || u.hostname.replace(/\./g, "-"));
    return stem || "captured-case";
  } catch {
    const withoutQuery = trimmed.split("?")[0] ?? trimmed;
    const pathOnly = withoutQuery
      .replace(/^\{\{[^}]+\}\}/i, "")
      .replace(/^https?:\/\/[^/]+/i, "");
    const stem = pathTailStem(pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`);
    return stem || "captured-case";
  }
}

function caseNameFromUrl(url: string): string {
  const fromTemplate = caseNameFromTemplatedUrl(url);
  if (fromTemplate !== "captured-case") return fromTemplate;
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return slugCaseName(parts[parts.length - 1] || u.hostname.replace(/\./g, "-"));
  } catch {
    return "captured-case";
  }
}

/** OpenAPI 等：operationId / 路径末段 / 方法+路径 → cases 文件名 */
export function caseStemFromOpenApiOperation(opts: {
  operationId?: string;
  method: string;
  pathTemplate: string;
}): string {
  const opId = opts.operationId?.trim();
  if (opId) {
    const fromId = slugCaseName(opId);
    if (fromId !== "captured-case") return fromId;
  }
  const path = opts.pathTemplate.startsWith("/") ? opts.pathTemplate : `/${opts.pathTemplate}`;
  const fromPath = caseNameFromTemplatedUrl(`{{base_url}}${path}`);
  if (fromPath !== "captured-case") return fromPath;
  const meth = opts.method.trim().toLowerCase() || "get";
  const tail = pathTailStem(path);
  if (tail) {
    const combined = slugCaseName(`${meth}-${tail}`);
    return combined !== "captured-case" ? combined : `${meth}-${tail}`.slice(0, 48);
  }
  return "openapi-case";
}

function templateUrl(url: string): { templated: string; origin?: string } {
  try {
    const u = new URL(url);
    const origin = `${u.protocol}//${u.host}`;
    return { templated: `{{base_url}}${u.pathname}${u.search}`, origin };
  } catch {
    return { templated: url };
  }
}

function yamlScalar(value: string, redactAsVar?: string): string {
  if (redactAsVar) return `"{{${redactAsVar}}}"`;
  if (!/[:#\n"'\\]/.test(value) && value.length < 120) return `"${value.replace(/"/g, '\\"')}"`;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatBodyLines(body: unknown, indent: string): string[] {
  if (body == null || body === "") return [];
  if (typeof body === "object") {
    return [`${indent}body: ${JSON.stringify(body)}`];
  }
  const text = String(body);
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return [`${indent}body: ${JSON.stringify(JSON.parse(text))}`];
    } catch {
      // fall through
    }
  }
  return [`${indent}body: ${yamlScalar(text)}`];
}

function headerLines(headers: Record<string, string>, indent: string): string[] {
  const lines: string[] = [`${indent}headers:`];
  let any = false;
  for (const [k, v] of Object.entries(headers)) {
    if (SKIP_HEADERS.has(k.toLowerCase())) continue;
    any = true;
    const varName = SENSITIVE_HEADER.test(k) ? k.toLowerCase().replace(/-/g, "_") : undefined;
    if (varName === "authorization") {
      lines.push(`${indent}  Authorization: "{{access_token}}"`);
    } else if (varName) {
      lines.push(`${indent}  ${k}: "{{${varName}}}"`);
    } else {
      lines.push(`${indent}  ${k}: ${yamlScalar(String(v))}`);
    }
  }
  return any ? lines : [];
}

export function captureTxToCaseYaml(tx: unknown): string {
  const t = tx as CaptureTx;
  const method = (t.request?.method ?? "GET").toUpperCase();
  const rawUrl = t.request?.url ?? "";
  const name = caseNameFromUrl(rawUrl);
  const status = t.response?.status ?? 200;

  const headers = { ...(t.request?.headers ?? {}) };
  const lines = [
    `name: ${name}`,
    "description: 由抓包生成",
    "request:",
    `  method: ${method}`,
    `  url: ${yamlScalar(rawUrl)}`,
  ];

  lines.push(...headerLines(headers, "  "));
  lines.push(...formatBodyLines(t.request?.body, "  "));

  lines.push(
    "assertions:",
    "  - type: status",
    `    equals: ${status}`,
    "  - type: duration_ms",
    "    max: 30000",
  );

  return lines.join("\n");
}

/** 工作台保存用例时的默认文件名（cases/*.yaml，不含扩展名） */
export function workbenchDraftCaseStem(draft: WorkbenchDraft): string {
  const url = buildUrl(draft.url, draft.query);
  const label = draft.name?.trim();
  if (label) {
    const fromLabel = slugCaseName(label);
    if (fromLabel !== "captured-case") return fromLabel;
  }
  return caseNameFromUrl(url);
}

export function workbenchDraftToCaseYaml(
  draft: WorkbenchDraft,
  responseStatus?: number,
  opts?: { displayName?: string },
): string {
  const url = buildUrl(draft.url, draft.query);
  const fileStem = workbenchDraftCaseStem(draft);
  const name = opts?.displayName?.trim() || fileStem;
  const method = draft.method.toUpperCase();
  const headers = headersForSend(draft);
  const body =
    draft.bodyMode === "raw" && method !== "GET" && method !== "HEAD" ? draft.body : undefined;

  const nameLine = /[:#\n"'\\]/.test(name) || /[\u4e00-\u9fff]/.test(name) ? `name: ${yamlScalar(name)}` : `name: ${name}`;
  const lines = [
    nameLine,
    "description: 由 API 工作台生成",
    "request:",
    `  method: ${method}`,
    `  url: ${yamlScalar(url)}`,
  ];
  lines.push(...headerLines(headers, "  "));
  if (body != null && body !== "") {
    lines.push(...formatBodyLines(body, "  "));
  }
  const status = responseStatus ?? 200;
  lines.push(
    "assertions:",
    "  - type: status",
    `    equals: ${status}`,
    "  - type: duration_ms",
    "    max: 30000",
  );
  return lines.join("\n");
}

export function captureTxToCaseMeta(tx: unknown): { defaultName: string; origin?: string } {
  const url = (tx as CaptureTx).request?.url ?? "";
  return { defaultName: caseNameFromUrl(url), origin: templateUrl(url).origin };
}

/** @deprecated use captureTxToCaseYaml */
export function captureTxToCaseDraft(tx: unknown): string {
  return captureTxToCaseYaml(tx);
}

type CaseYamlDoc = {
  name?: string;
  request?: {
    method?: string;
    url?: string;
    headers?: Record<string, string | number | boolean>;
    body?: unknown;
  };
};

function splitUrlWithTemplate(rawUrl: string): { baseUrl: string; query: ReturnType<typeof splitUrlAndQuery>["query"] } {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { baseUrl: "", query: [emptyRow()] };
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (!u.hostname.includes("{")) {
      return splitUrlAndQuery(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    }
  } catch {
    // 含 {{base_url}} 等模板变量，走下方手动拆分
  }
  const q = trimmed.indexOf("?");
  if (q < 0) return { baseUrl: trimmed, query: [emptyRow()] };
  const baseUrl = trimmed.slice(0, q);
  const queryPart = trimmed.slice(q + 1);
  const query = queryPart.split("&").map((pair) => {
    const eq = pair.indexOf("=");
    if (eq < 0) return { key: decodeURIComponent(pair), value: "", enabled: true };
    return {
      key: decodeURIComponent(pair.slice(0, eq)),
      value: decodeURIComponent(pair.slice(eq + 1)),
      enabled: true,
    };
  });
  return { baseUrl, query: query.length ? query : [emptyRow()] };
}

export function caseYamlToWorkbenchDraft(yamlText: string): WorkbenchDraft | null {
  let doc: CaseYamlDoc;
  try {
    doc = yaml.load(yamlText) as CaseYamlDoc;
  } catch {
    return null;
  }
  const req = doc.request;
  if (!req?.url) return null;
  const method = (req.method ?? "GET").toUpperCase();
  let url = String(req.url).trim();
  url = url.replace(/\{\{base_url\}\}\/+/gi, "{{base_url}}/");
  const { baseUrl, query } = splitUrlWithTemplate(url);
  const headerRecord: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    headerRecord[k] = String(v);
  }
  let body = "";
  let bodyMode: "none" | "raw" = "none";
  if (req.body != null && req.body !== "" && method !== "GET" && method !== "HEAD") {
    bodyMode = "raw";
    body = typeof req.body === "string" ? req.body : JSON.stringify(req.body, null, 2);
  }
  const promoted = promoteQueryAuthToHeaders(headersToRows(headerRecord), query);
  const draft: WorkbenchDraft = {
    name: doc.name,
    method,
    url: baseUrl,
    headers: promoted.headers,
    query: promoted.query,
    bodyMode,
    body,
    bodyContentType: "application/json",
  };
  return normalizeRawBodyDraft(draft);
}