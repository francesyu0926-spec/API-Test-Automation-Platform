import type { KeyValueRow } from "../../shared/apiWorkbenchTypes";
import { emptyRow } from "./apiWorkbenchModel";

export type KvBulkFormat = "query" | "json";

function contentRows(rows: KeyValueRow[]): KeyValueRow[] {
  return rows.filter((r) => r.key.trim() || r.value.trim());
}

export function serializeKvBulk(rows: KeyValueRow[], format: KvBulkFormat): string {
  const active = contentRows(rows);
  if (!active.length) return "";
  if (format === "json") {
    const obj: Record<string, string> = {};
    for (const r of active) {
      if (r.enabled) obj[r.key] = r.value;
    }
    return JSON.stringify(obj, null, 2);
  }
  return active
    .filter((r) => r.enabled)
    .map((r) => `${r.key}=${r.value}`)
    .join("&");
}

export function parseKvBulk(text: string, format: KvBulkFormat): KeyValueRow[] {
  const trimmed = text.trim();
  if (!trimmed) return [emptyRow()];

  if (format === "json") {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const rows = Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
          key,
          value: value == null ? "" : String(value),
          enabled: true,
        }));
        return rows.length ? [...rows, emptyRow()] : [emptyRow()];
      }
      if (Array.isArray(parsed)) {
        const rows: KeyValueRow[] = [];
        for (const item of parsed) {
          if (!item || typeof item !== "object") continue;
          const rec = item as Record<string, unknown>;
          const key = rec.key != null ? String(rec.key) : "";
          const value = rec.value != null ? String(rec.value) : "";
          if (key || value) rows.push({ key, value, enabled: rec.enabled !== false });
        }
        return rows.length ? [...rows, emptyRow()] : [emptyRow()];
      }
    } catch {
      /* fall through to line / query parsing */
    }
  }

  if (trimmed.includes("=")) {
    const rows: KeyValueRow[] = [];
    const chunks = trimmed.replace(/^\?/, "").split("&");
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      const eq = chunk.indexOf("=");
      if (eq < 0) {
        rows.push({ key: decodeURIComponent(chunk.trim()), value: "", enabled: true });
      } else {
        const key = decodeURIComponent(chunk.slice(0, eq).trim());
        const value = decodeURIComponent(chunk.slice(eq + 1));
        rows.push({ key, value, enabled: true });
      }
    }
    if (rows.length) return [...rows, emptyRow()];
  }

  const lineRows: KeyValueRow[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const part = line.trim();
    if (!part) continue;
    const colon = part.match(/^([^:=]+)[:=]\s*(.*)$/);
    if (colon) {
      lineRows.push({ key: colon[1].trim(), value: colon[2], enabled: true });
    }
  }
  return lineRows.length ? [...lineRows, emptyRow()] : [emptyRow()];
}