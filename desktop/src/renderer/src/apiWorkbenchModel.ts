import type { KeyValueRow, SavedApiRequest, WorkbenchDraft } from "../../shared/apiWorkbenchTypes";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export { HTTP_METHODS };

const SKIP_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "proxy-connection",
]);

export function emptyRow(): KeyValueRow {
  return { key: "", value: "", enabled: true };
}

export function defaultDraft(): WorkbenchDraft {
  return {
    method: "GET",
    url: "",
    headers: [emptyRow()],
    query: [emptyRow()],
    bodyMode: "none",
    body: "",
    bodyContentType: "application/json",
  };
}

export function splitUrlAndQuery(rawUrl: string): { baseUrl: string; query: KeyValueRow[] } {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { baseUrl: "", query: [emptyRow()] };
  try {
    const u = new URL(trimmed);
    const query: KeyValueRow[] = [];
    u.searchParams.forEach((value, key) => {
      query.push({ key, value, enabled: true });
    });
    u.search = "";
    return { baseUrl: u.toString(), query: query.length ? query : [emptyRow()] };
  } catch {
    return { baseUrl: trimmed, query: [emptyRow()] };
  }
}

export function buildUrl(baseUrl: string, query: KeyValueRow[]): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    u.search = "";
    for (const row of query) {
      if (!row.enabled || !row.key.trim()) continue;
      u.searchParams.append(row.key.trim(), row.value);
    }
    return u.toString();
  } catch {
    return trimmed;
  }
}

export function headersToRows(headers: Record<string, string> | undefined): KeyValueRow[] {
  const rows: KeyValueRow[] = [];
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (SKIP_HEADERS.has(k.toLowerCase())) continue;
    rows.push({ key: k, value: String(v), enabled: true });
  }
  return rows.length ? rows : [emptyRow()];
}

export function rowsToRecord(rows: KeyValueRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!row.enabled || !row.key.trim()) continue;
    out[row.key.trim()] = row.value;
  }
  return out;
}

export function contentTypeFromHeaders(
  headers: Record<string, string> | undefined,
): string | undefined {
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === "content-type") return v.split(";")[0].trim();
  }
  return undefined;
}

export function contentTypeFromRows(rows: KeyValueRow[]): string | undefined {
  for (const row of rows) {
    if (!row.enabled) continue;
    if (row.key.trim().toLowerCase() === "content-type") {
      return row.value.split(";")[0].trim();
    }
  }
  return undefined;
}

export function headersWithoutContentType(rows: KeyValueRow[]): KeyValueRow[] {
  const filtered = rows.filter((r) => r.key.trim().toLowerCase() !== "content-type");
  return filtered.length ? filtered : [emptyRow()];
}

export function inferBodyContentType(headers: Record<string, string> | undefined, body: string): string {
  const fromHeader = contentTypeFromHeaders(headers);
  if (fromHeader) return fromHeader;
  const trimmed = body.trim();
  if (!trimmed) return "application/json";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "application/json";
  if (/^[^=&]+=[^=&]*(&[^=&]+=[^=&]*)*$/.test(trimmed)) {
    return "application/x-www-form-urlencoded";
  }
  return "text/plain";
}

/** raw Body 时 Content-Type 仅由 Body 页签控制，不从 Headers 重复发送 */
export function normalizeRawBodyDraft(draft: WorkbenchDraft): WorkbenchDraft {
  if (draft.bodyMode !== "raw") return draft;
  const fromRows = contentTypeFromRows(draft.headers);
  const bodyContentType = draft.bodyContentType ?? fromRows ?? inferBodyContentType(undefined, draft.body);
  return {
    ...draft,
    bodyContentType,
    headers: headersWithoutContentType(draft.headers),
  };
}

const QUERY_AUTH_KEYS = new Set(["token", "access_token", "accesstoken", "access-token", "authorization"]);
const QUERY_KEEP_IN_URL = new Set(["_t", "t", "timestamp", "nonce", "sign", "callback", "rnd"]);

function hasAuthHeaderRow(headers: KeyValueRow[]): boolean {
  return headers.some(
    (r) => r.enabled && /^(authorization|token|access-token|x-access-token)$/i.test(r.key.trim()),
  );
}

/** 鉴权类 Query 参数放入 Headers（_t 等缓存参数仍留在 Params） */
export function promoteQueryAuthToHeaders(
  headers: KeyValueRow[],
  query: KeyValueRow[],
): { headers: KeyValueRow[]; query: KeyValueRow[] } {
  const outHeaders = headers.filter((r) => r.key.trim() || r.value);
  let hasAuth = hasAuthHeaderRow(outHeaders);
  const outQuery: KeyValueRow[] = [];

  for (const row of query) {
    if (!row.key.trim() && !row.value) continue;
    if (!row.enabled) {
      outQuery.push(row);
      continue;
    }
    const key = row.key.trim();
    const kl = key.toLowerCase();
    if (QUERY_KEEP_IN_URL.has(kl)) {
      outQuery.push(row);
      continue;
    }
    if (QUERY_AUTH_KEYS.has(kl)) {
      if (hasAuth) continue;
      const v = row.value;
      if (kl === "token") {
        outHeaders.push({ key: "token", value: v, enabled: true });
      } else {
        const bearer = v.startsWith("Bearer ") ? v : `Bearer ${v}`;
        outHeaders.push({ key: "Authorization", value: bearer, enabled: true });
      }
      hasAuth = true;
      continue;
    }
    outQuery.push(row);
  }

  return {
    headers: outHeaders.length ? outHeaders : [emptyRow()],
    query: outQuery.length ? outQuery : [emptyRow()],
  };
}

export function headersForSend(draft: WorkbenchDraft): Record<string, string> {
  const headers = rowsToRecord(draft.headers);
  const hasBody =
    draft.bodyMode === "raw" &&
    draft.body !== "" &&
    draft.method !== "GET" &&
    draft.method !== "HEAD";
  if (hasBody && draft.bodyContentType) {
    headers["Content-Type"] = draft.bodyContentType;
  }
  return headers;
}

export function captureTxToDraft(tx: unknown): WorkbenchDraft {
  const t = tx as {
    request?: {
      method?: string;
      url?: string;
      headers?: Record<string, string>;
      body?: unknown;
    };
  };
  const method = (t.request?.method ?? "GET").toUpperCase();
  const url = t.request?.url ?? "";
  const { baseUrl, query } = splitUrlAndQuery(url);
  const rawHeaders = t.request?.headers;
  let body = "";
  let bodyMode: "none" | "raw" = "none";
  const rawBody = t.request?.body;
  if (rawBody != null && rawBody !== "" && method !== "GET" && method !== "HEAD") {
    bodyMode = "raw";
    body = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody, null, 2);
  }
  const headers = headersToRows(rawHeaders);
  let name: string | undefined;
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    name = parts[parts.length - 1] || u.hostname;
  } catch {
    name = "抓包导入";
  }
  const promoted = promoteQueryAuthToHeaders(headers, query);
  const draft: WorkbenchDraft = {
    name,
    folder: (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return undefined;
      }
    })(),
    method,
    url: baseUrl,
    headers: promoted.headers,
    query: promoted.query,
    bodyMode,
    body,
    bodyContentType: inferBodyContentType(rawHeaders, body),
  };
  return normalizeRawBodyDraft(draft);
}

export function savedRequestToDraft(req: SavedApiRequest): WorkbenchDraft {
  const { baseUrl, query } = splitUrlAndQuery(req.url);
  const headers = req.headers.length ? req.headers : [emptyRow()];
  const mergedQuery = query.some((q) => q.key.trim()) ? query : req.query?.length ? req.query : [emptyRow()];
  const promoted = promoteQueryAuthToHeaders(headers, mergedQuery);
  const draft: WorkbenchDraft = {
    name: req.name,
    folder: req.folder,
    method: req.method,
    url: baseUrl,
    headers: promoted.headers,
    query: promoted.query,
    bodyMode: req.bodyMode,
    body: req.body,
    bodyContentType:
      req.bodyContentType ?? contentTypeFromRows(headers) ?? inferBodyContentType(undefined, req.body),
  };
  return normalizeRawBodyDraft(draft);
}

export function draftToSavedRequest(id: string, draft: WorkbenchDraft): SavedApiRequest {
  return {
    id,
    name: draft.name?.trim() || "未命名请求",
    folder: draft.folder?.trim() || undefined,
    method: draft.method,
    url: buildUrl(draft.url, draft.query),
    headers: draft.headers.filter((r) => r.key.trim() || r.value),
    query: draft.query.filter((r) => r.key.trim() || r.value),
    bodyMode: draft.bodyMode,
    body: draft.body,
    bodyContentType: draft.bodyContentType,
  };
}

export function formatJsonBody(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** 工作台状态条颜色：304 等为缓存/重定向，不应标红 */
export function httpStatusTone(status: number, ok: boolean): "ok" | "warn" | "err" {
  if (ok) return "ok";
  if (status === 304 || status === 204) return "warn";
  if (status >= 400) return "err";
  if (status >= 300) return "warn";
  return "err";
}

export function httpEmptyBodyHint(status: number, bodySize: number): string | null {
  if (status === 304) {
    return (
      "304 Not Modified：服务器认为资源未变化，不返回正文（协议规定 0 字节）。\n\n" +
      "常见原因：Headers 里带有 If-None-Match、If-Modified-Since 等「条件请求」头（多来自抓包导入）。\n" +
      "需要完整 HTML/JSON 时：在 Headers 中取消勾选或删除上述请求头后重新 Send。"
    );
  }
  if (status === 204 && bodySize === 0) {
    return "204 No Content：成功且无响应体。";
  }
  return null;
}