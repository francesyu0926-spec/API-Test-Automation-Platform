import type { VisualSection } from "./jsonVisualModel";

/** 各可视化区块勾选的行号（0 起，对应接口全量数组下标） */
export type VisualRowSelection = Record<string, number[]>;

export function sectionExportKey(sec: VisualSection, idx: number): string {
  if (sec.kind === "kv") return `kv:${sec.title ?? ""}:${idx}`;
  return `arr:${sec.title}:${idx}`;
}

export function countSelectedRows(selection: VisualRowSelection): number {
  return Object.values(selection).reduce((n, rows) => n + (rows?.length ?? 0), 0);
}

export function toggleSelectionRow(
  selection: VisualRowSelection,
  key: string,
  index: number,
): VisualRowSelection {
  const set = new Set(selection[key] ?? []);
  if (set.has(index)) set.delete(index);
  else set.add(index);
  const next = [...set].sort((a, b) => a - b);
  if (!next.length) {
    const { [key]: _removed, ...rest } = selection;
    return rest;
  }
  return { ...selection, [key]: next };
}

export function setSelectionAll(selection: VisualRowSelection, key: string, count: number): VisualRowSelection {
  if (count <= 0) {
    const { [key]: _removed, ...rest } = selection;
    return rest;
  }
  return {
    ...selection,
    [key]: Array.from({ length: count }, (_, i) => i),
  };
}

export function clearSectionSelection(selection: VisualRowSelection, key: string): VisualRowSelection {
  const { [key]: _removed, ...rest } = selection;
  return rest;
}