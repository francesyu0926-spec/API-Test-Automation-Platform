import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import { normalizeRawBodyDraft } from "./apiWorkbenchModel";
import { resolveWorkbenchPayload } from "./resolveWorkbenchRequest";

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

export function draftToCurl(
  draft: WorkbenchDraft,
  variables: Record<string, string>,
  opts?: { insecureTls?: boolean },
): string {
  const normalized = normalizeRawBodyDraft(draft);
  let payload;
  try {
    payload = resolveWorkbenchPayload(normalized, variables);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `# 无法生成 cURL：${msg}`;
  }

  const method = payload.method.toUpperCase();
  const url = payload.url.trim();
  if (!url) return "# 请先填写 URL";

  const parts: string[] = [`curl -X ${method} '${escapeSingleQuoted(url)}'`];
  for (const [k, v] of Object.entries(payload.headers ?? {})) {
    if (SKIP_HEADERS.has(k.toLowerCase())) continue;
    parts.push(`  -H '${escapeSingleQuoted(k)}: ${escapeSingleQuoted(v)}'`);
  }

  if (payload.body != null && payload.body !== "" && method !== "GET" && method !== "HEAD") {
    parts.push(`  --data-raw '${escapeSingleQuoted(payload.body)}'`);
  }

  if (opts?.insecureTls) {
    parts.push("  --insecure");
  }

  parts.push("  --compressed");
  return parts.join(" \\\n");
}