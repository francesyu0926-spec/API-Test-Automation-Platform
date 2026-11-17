export type CaptureRequest = {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

const SKIP_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "proxy-connection",
]);

function escapeSingleQuoted(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

export function transactionToCurl(tx: unknown): string {
  const t = tx as { request?: CaptureRequest };
  const method = (t.request?.method ?? "GET").toUpperCase();
  const url = t.request?.url ?? "";
  if (!url) return "# 无 URL";

  const parts: string[] = [`curl -X ${method} '${escapeSingleQuoted(url)}'`];
  const headers = t.request?.headers ?? {};
  for (const [k, v] of Object.entries(headers)) {
    if (SKIP_HEADERS.has(k.toLowerCase())) continue;
    parts.push(`  -H '${escapeSingleQuoted(k)}: ${escapeSingleQuoted(String(v))}'`);
  }

  const body = t.request?.body;
  if (body != null && body !== "" && method !== "GET" && method !== "HEAD") {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    parts.push(`  --data-raw '${escapeSingleQuoted(raw)}'`);
  }

  parts.push("  --compressed");
  return parts.join(" \\\n");
}