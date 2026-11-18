import type { KeyValueRow, WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import {
  defaultDraft,
  emptyRow,
  inferBodyContentType,
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

function normalizeCurlText(raw: string): string {
  return raw
    .trim()
    .replace(/\\\r?\n/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readQuotedArg(s: string, start: number): { value: string; end: number } | null {
  const q = s[start];
  if (q !== "'" && q !== '"') return null;
  let i = start + 1;
  let out = "";
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      out += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === q) return { value: out, end: i + 1 };
    out += ch;
    i++;
  }
  return null;
}

function nextToken(s: string, pos: number): { token: string; end: number } {
  while (pos < s.length && s[pos] === " ") pos++;
  if (pos >= s.length) return { token: "", end: pos };
  if (s[pos] === "'" || s[pos] === '"') {
    const q = readQuotedArg(s, pos);
    if (!q) return { token: "", end: s.length };
    return { token: q.value, end: q.end };
  }
  const m = s.slice(pos).match(/^[^\s]+/);
  const token = m?.[0] ?? "";
  return { token, end: pos + token.length };
}

function parseHeaderLine(line: string): { key: string; value: string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  return { key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() };
}

export function parseCurlToDraft(raw: string): { draft: WorkbenchDraft; warnings: string[] } | null {
  const warnings: string[] = [];
  let text = normalizeCurlText(raw);
  if (!text) return null;

  let method = "GET";
  const headers: KeyValueRow[] = [];
  let body = "";
  let url = "";

  if (/^curl\b/i.test(text)) {
    text = text.replace(/^curl\s+/i, "");
  } else if (/^https?:\/\//i.test(text)) {
    url = text.split(/\s+/)[0];
    const { baseUrl, query } = splitUrlAndQuery(url);
    const promoted = promoteQueryAuthToHeaders([emptyRow()], query);
    return {
      draft: normalizeRawBodyDraft({
        ...defaultDraft(),
        method: "GET",
        url: baseUrl,
        headers: promoted.headers,
        query: promoted.query,
      }),
      warnings: [],
    };
  } else {
    return null;
  }

  let pos = 0;
  while (pos < text.length) {
    while (pos < text.length && text[pos] === " ") pos++;
    if (pos >= text.length) break;

    if (text[pos] === "-") {
      const { token: flag, end: afterFlag } = nextToken(text, pos);
      pos = afterFlag;
      const flagLower = flag.toLowerCase();

      if (flagLower === "-x" || flagLower === "--request") {
        const { token: m, end } = nextToken(text, pos);
        if (m) method = m.toUpperCase();
        pos = end;
        continue;
      }

      if (
        flagLower === "-h" ||
        flagLower === "--header"
      ) {
        const { token: hv, end } = nextToken(text, pos);
        pos = end;
        const parsed = parseHeaderLine(hv);
        if (parsed && !SKIP_HEADERS.has(parsed.key.toLowerCase())) {
          headers.push({ key: parsed.key, value: parsed.value, enabled: true });
        }
        continue;
      }

      if (
        flagLower === "-d" ||
        flagLower === "--data" ||
        flagLower === "--data-raw" ||
        flagLower === "--data-binary"
      ) {
        const { token: data, end } = nextToken(text, pos);
        pos = end;
        if (data.startsWith("@")) {
          warnings.push(`跳过本地文件引用：${data}`);
        } else {
          body = data;
        }
        continue;
      }

      if (
        flagLower === "--compressed" ||
        flagLower === "-k" ||
        flagLower === "--insecure" ||
        flagLower === "-s" ||
        flagLower === "--silent" ||
        flagLower === "-i" ||
        flagLower === "--include" ||
        flagLower === "-L" ||
        flagLower === "--location"
      ) {
        continue;
      }

      const { token: skip, end } = nextToken(text, pos);
      pos = end;
      if (skip) warnings.push(`未解析参数 ${flag} ${skip}`);
      continue;
    }

    const { token, end } = nextToken(text, pos);
    pos = end;
    if (/^https?:\/\//i.test(token) && !url) {
      url = token;
    }
  }

  if (!url) {
    const m = raw.match(/https?:\/\/[^\s'"]+/i);
    url = m?.[0] ?? "";
  }
  if (!url) return null;

  const { baseUrl, query } = splitUrlAndQuery(url);
  const promoted = promoteQueryAuthToHeaders(
    headers.length ? headers : [emptyRow()],
    query,
  );
  const hasBody = body !== "" && method !== "GET" && method !== "HEAD";
  const draft: WorkbenchDraft = {
    ...defaultDraft(),
    method,
    url: baseUrl,
    headers: promoted.headers,
    query: promoted.query,
    bodyMode: hasBody ? "raw" : "none",
    body: hasBody ? body : "",
    bodyContentType: hasBody ? inferBodyContentType(undefined, body) : "application/json",
  };
  return { draft: normalizeRawBodyDraft(draft), warnings };
}