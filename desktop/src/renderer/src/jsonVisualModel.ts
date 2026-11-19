export const MAX_TABLE_ROWS = 500;
export const MAX_FLAT_COLS = 28;
export const MAX_FLAT_DEPTH = 4;

export function isPrimitive(value: unknown): value is string | number | boolean {
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type FlatColumn = { path: string; header: string };

export function inferColumnCellKind(rows: Record<string, unknown>[], path: string): "num" | "text" {
  for (const row of rows) {
    const v = getAtPath(row, path);
    if (v === null || v === undefined) continue;
    if (typeof v === "number" || typeof v === "boolean") return "num";
    return "text";
  }
  return "text";
}

export function getAtPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** 从对象行样本收集点路径列（仅叶子标量；对象/数组保留为复合列） */
export function collectFlatColumns(
  rows: Record<string, unknown>[],
  maxDepth = MAX_FLAT_DEPTH,
  maxCols = MAX_FLAT_COLS,
): FlatColumn[] {
  const paths = new Set<string>();

  const walk = (val: unknown, prefix: string, depth: number) => {
    if (paths.size >= maxCols) return;

    if (val === null || isPrimitive(val)) {
      if (prefix) paths.add(prefix);
      return;
    }

    if (Array.isArray(val)) {
      if (prefix) paths.add(prefix);
      return;
    }

    if (!isRecord(val)) return;

    if (depth >= maxDepth) {
      if (prefix) paths.add(prefix);
      return;
    }

    const entries = Object.entries(val);
    if (entries.length === 0) {
      if (prefix) paths.add(prefix);
      return;
    }

    for (const [k, v] of entries) {
      walk(v, prefix ? `${prefix}.${k}` : k, depth + 1);
    }
  };

  for (const row of rows.slice(0, 40)) {
    if (!isRecord(row)) continue;
    for (const [k, v] of Object.entries(row)) {
      walk(v, k, 0);
    }
  }

  return [...paths].map((path) => ({ path, header: path }));
}

export function isArrayOfRecords(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  let objectCount = 0;
  for (const item of value.slice(0, 25)) {
    if (isRecord(item)) objectCount++;
  }
  return objectCount >= Math.max(1, Math.ceil(Math.min(value.length, 25) * 0.4));
}

export function formatJsonPrimitive(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  if (isRecord(value)) return `{${Object.keys(value).length}}`;
  return String(value);
}

export function complexSummary(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (isPrimitive(value[0]) || value.every(isPrimitive)) {
      return value.map((x) => formatJsonPrimitive(x)).join(", ");
    }
    return `数组 · ${value.length} 项`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length <= 4 && keys.every((k) => isPrimitive(value[k]) || value[k] === null)) {
      return keys.map((k) => `${k}=${formatJsonPrimitive(value[k])}`).join(" · ");
    }
    return `对象 · ${keys.length} 字段`;
  }
  return formatJsonPrimitive(value);
}

export type VisualSection =
  | { kind: "kv"; title?: string; entries: Array<[string, unknown]> }
  | { kind: "array"; title: string; rows: unknown[] }
  | { kind: "nested"; title: string; value: unknown };

/** 将任意 JSON 拆成 KV 表 + 多个数组表（适配 { code, data: [...] } 等多层结构） */
export function buildVisualSections(data: unknown, title?: string, depth = 0): VisualSection[] {
  if (depth > 6) {
    return [{ kind: "kv", title, entries: [["(value)", data]] }];
  }

  if (Array.isArray(data)) {
    return [{ kind: "array", title: title ?? "列表", rows: data }];
  }

  if (!isRecord(data)) {
    return [{ kind: "kv", title, entries: [["值", data]] }];
  }

  const sections: VisualSection[] = [];
  const kv: Array<[string, unknown]> = [];
  const nestedObjects: Array<[string, unknown]> = [];

  for (const [k, v] of Object.entries(data)) {
    if (v === null || isPrimitive(v)) {
      kv.push([k, v]);
    } else if (Array.isArray(v)) {
      sections.push({ kind: "array", title: k, rows: v });
    } else if (isRecord(v)) {
      const innerArrays = Object.entries(v).filter(([, child]) => Array.isArray(child));
      const innerScalars = Object.entries(v).filter(
        ([, child]) => child === null || isPrimitive(child),
      );
      if (innerArrays.length > 0) {
        if (innerScalars.length) {
          sections.unshift({
            kind: "kv",
            title: `${k}（摘要）`,
            entries: innerScalars.map(([ik, iv]) => [`${k}.${ik}`, iv] as [string, unknown]),
          });
        }
        for (const [ik, arr] of innerArrays) {
          sections.push({ kind: "array", title: `${k}.${ik}`, rows: arr as unknown[] });
        }
        const rest = Object.fromEntries(
          Object.entries(v).filter(
            ([ik, child]) => !Array.isArray(child) && child !== null && !isPrimitive(child),
          ),
        );
        if (Object.keys(rest).length) nestedObjects.push([k, rest]);
      } else {
        nestedObjects.push([k, v]);
      }
    }
  }

  if (kv.length) sections.unshift({ kind: "kv", title, entries: kv });
  for (const [k, v] of nestedObjects) {
    sections.push(...buildVisualSections(v, k, depth + 1));
  }

  if (!sections.length) {
    return [{ kind: "kv", title, entries: Object.entries(data) }];
  }

  const kvSecs = sections.filter((s) => s.kind === "kv");
  const arrSecs = sections
    .filter((s): s is Extract<VisualSection, { kind: "array" }> => s.kind === "array")
    .sort((a, b) => (b.rows?.length ?? 0) - (a.rows?.length ?? 0));
  return [...kvSecs, ...arrSecs];
}

export function rowRecords(rows: unknown[]): Record<string, unknown>[] {
  return rows.filter(isRecord) as Record<string, unknown>[];
}