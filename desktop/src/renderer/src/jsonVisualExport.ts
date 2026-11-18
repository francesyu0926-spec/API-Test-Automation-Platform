import * as XLSX from "xlsx";

import {
  buildVisualSections,
  collectFlatColumns,
  getAtPath,
  isPrimitive,
  isRecord,
  rowRecords,
} from "./jsonVisualModel";
import { sectionExportKey, type VisualRowSelection } from "./jsonVisualSelection";

export type ExportTableSheet = {
  sheetName: string;
  columns: string[];
  rows: string[][];
};

const EXPORT_MAX_COLS = 96;
const EXPORT_MAX_DEPTH = 8;
const PNG_MAX_HEIGHT = 16_000;

/** PNG 导出仅支持自选行，且合计不超过该条数 */
export const PNG_EXPORT_MAX_ROWS = 20;

function cellExportValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isPrimitive(value)) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sanitizeSheetName(name: string, used: Set<string>): string {
  let base = name
    .replace(/[\\/?*[\]:]/g, "_")
    .slice(0, 28)
    .trim();
  if (!base) base = "Sheet";
  let final = base;
  let n = 2;
  while (used.has(final)) {
    final = `${base.slice(0, 24)}_${n}`;
    n++;
  }
  used.add(final);
  return final;
}

export type BuildExportSheetsOptions = {
  mode?: "all" | "selected";
  selection?: VisualRowSelection;
};

function pickIndices(total: number, mode: "all" | "selected", key: string, selection: VisualRowSelection): number[] | null {
  if (mode === "all") {
    return Array.from({ length: total }, (_, i) => i);
  }
  const picked = selection[key];
  if (!picked?.length) return null;
  const allowed = new Set(picked);
  return [...allowed].filter((i) => i >= 0 && i < total).sort((a, b) => a - b);
}

/** 从 JSON 构建导出表格（不受界面 500 行限制；可选仅导出勾选行） */
export function buildExportSheets(data: unknown, opts?: BuildExportSheetsOptions): ExportTableSheet[] {
  const mode = opts?.mode ?? "all";
  const selection = opts?.selection ?? {};
  const sections = buildVisualSections(data);
  const used = new Set<string>();
  const sheets: ExportTableSheet[] = [];

  sections.forEach((sec, idx) => {
    const sectionKey = sectionExportKey(sec, idx);

    if (sec.kind === "kv") {
      const indices = pickIndices(sec.entries.length, mode, sectionKey, selection);
      if (indices == null) return;
      const pickedEntries = indices.map((i) => sec.entries[i]).filter(Boolean);
      if (!pickedEntries.length && mode === "selected") return;
      sheets.push({
        sheetName: sanitizeSheetName(sec.title || "摘要", used),
        columns: ["字段", "值"],
        rows: pickedEntries.map(([k, v]) => [k, cellExportValue(v)]),
      });
      return;
    }
    if (sec.kind !== "array") return;

    const rows = Array.isArray(sec.rows) ? sec.rows : [];
    const records = rowRecords(rows);
    const title = sanitizeSheetName(sec.title || "列表", used);

    if (records.length > 0 && (records.length >= Math.ceil(rows.length * 0.5) || isRecord(rows[0]))) {
      const indices = pickIndices(records.length, mode, sectionKey, selection);
      if (indices == null) return;
      const subset = indices.map((i) => records[i]).filter(isRecord);
      if (!subset.length) return;
      const flatCols = collectFlatColumns(subset.length === records.length ? records : subset, EXPORT_MAX_DEPTH, EXPORT_MAX_COLS);
      const paths = flatCols.map((c) => c.path);
      const header = ["#", ...paths];
      const dataRows = subset.map((rec, pos) => [
        String(indices[pos] + 1),
        ...paths.map((p) => cellExportValue(getAtPath(rec, p))),
      ]);
      sheets.push({ sheetName: title, columns: header, rows: dataRows });
    } else {
      const indices = pickIndices(rows.length, mode, sectionKey, selection);
      if (indices == null) return;
      const subset = indices.map((i) => rows[i]);
      if (!subset.length) return;
      sheets.push({
        sheetName: title,
        columns: ["#", "值"],
        rows: subset.map((v, pos) => [String(indices[pos] + 1), cellExportValue(v)]),
      });
    }
  });

  if (!sheets.length) {
    if (mode === "selected") return [];
    sheets.push({
      sheetName: sanitizeSheetName("数据", used),
      columns: ["值"],
      rows: [[cellExportValue(data)]],
    });
  }

  return sheets;
}

export function exportSheetsToXlsxBase64(sheets: ExportTableSheet[]): string {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const aoa = [sheet.columns, ...sheet.rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, sheet.sheetName);
  }
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
}

type ColLayout = { x: number; w: number };

function measureColumns(
  ctx: CanvasRenderingContext2D,
  columns: string[],
  rows: string[][],
  sampleRows: number,
): ColLayout[] {
  const padding = 8;
  const minW = 48;
  const maxW = 220;
  const widths = columns.map((col, colIdx) => {
    let w = ctx.measureText(col).width + padding * 2;
    const limit = Math.min(sampleRows, rows.length);
    for (let i = 0; i < limit; i++) {
      const cell = rows[i]?.[colIdx] ?? "";
      w = Math.max(w, ctx.measureText(cell.length > 80 ? `${cell.slice(0, 80)}…` : cell).width + padding * 2);
    }
    return Math.min(maxW, Math.max(minW, Math.ceil(w)));
  });
  let x = 0;
  return widths.map((w) => {
    const layout = { x, w };
    x += w;
    return layout;
  });
}

function drawSheetTable(
  ctx: CanvasRenderingContext2D,
  y0: number,
  sheet: ExportTableSheet,
  canvasWidth: number,
): number {
  const rowH = 22;
  const headH = 26;
  const titleH = sheet.sheetName ? 28 : 0;
  let y = y0;

  ctx.fillStyle = "#e8e0d4";
  ctx.font = "600 13px 'Segoe UI', 'Microsoft YaHei UI', sans-serif";
  if (titleH) {
    ctx.fillText(sheet.sheetName, 12, y + 18);
    y += titleH;
  }

  const cols = measureColumns(ctx, sheet.columns, sheet.rows, 80);
  const tableW = Math.min(canvasWidth - 24, cols.reduce((s, c) => s + c.w, 0));
  const scale = tableW / cols.reduce((s, c) => s + c.w, 0);
  const scaledCols = cols.map((c) => ({ x: c.x * scale, w: c.w * scale }));

  // header
  ctx.fillStyle = "#151d2e";
  ctx.fillRect(12, y, tableW, headH);
  ctx.fillStyle = "#d4b06e";
  ctx.font = "600 11px 'Segoe UI', 'Microsoft YaHei UI', sans-serif";
  for (let i = 0; i < sheet.columns.length; i++) {
    const col = scaledCols[i];
    if (!col) continue;
    const text = sheet.columns[i];
    ctx.fillText(text.length > 24 ? `${text.slice(0, 24)}…` : text, 12 + col.x + 6, y + 17);
  }
  y += headH;

  ctx.font = "11px 'Consolas', 'Segoe UI', monospace";
  for (let r = 0; r < sheet.rows.length; r++) {
    if (y + rowH > PNG_MAX_HEIGHT - 40) break;
    ctx.fillStyle = r % 2 === 0 ? "#1e2433" : "#1a1f2c";
    ctx.fillRect(12, y, tableW, rowH);
    ctx.fillStyle = "#e8e8e8";
    const row = sheet.rows[r] ?? [];
    for (let c = 0; c < sheet.columns.length; c++) {
      const col = scaledCols[c];
      if (!col) continue;
      const raw = row[c] ?? "";
      const text = raw.length > 36 ? `${raw.slice(0, 36)}…` : raw;
      ctx.fillText(text, 12 + col.x + 6, y + 15);
    }
    y += rowH;
  }

  return y - y0 + 12;
}

/** 将全量表格绘制为 PNG（base64，无 data: 前缀） */
export function exportSheetsToPngBase64(sheets: ExportTableSheet[]): { base64: string; truncated: boolean } {
  const canvasWidth = 1400;
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  if (!measureCtx) throw new Error("canvas");

  let totalH = 24;
  let truncated = false;
  for (const sheet of sheets) {
    const titleH = sheet.sheetName ? 28 : 0;
    const rowsH = Math.min(sheet.rows.length, Math.floor((PNG_MAX_HEIGHT - totalH - titleH - 40) / 22));
    if (rowsH < sheet.rows.length) truncated = true;
    totalH += titleH + 26 + rowsH * 22 + 16;
    if (totalH >= PNG_MAX_HEIGHT) {
      truncated = true;
      totalH = PNG_MAX_HEIGHT;
      break;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = Math.max(120, Math.min(PNG_MAX_HEIGHT, totalH));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");

  ctx.fillStyle = "#141820";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let y = 12;
  for (const sheet of sheets) {
    if (y >= canvas.height - 40) {
      truncated = true;
      break;
    }
    const used = drawSheetTable(ctx, y, sheet, canvasWidth);
    y += used;
  }

  if (truncated) {
    ctx.fillStyle = "#c48e4d";
    ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.fillText("（图片高度受限，完整数据请导出 XLSX）", 12, canvas.height - 10);
  }

  const dataUrl = canvas.toDataURL("image/png");
  return { base64: dataUrl.replace(/^data:image\/png;base64,/, ""), truncated };
}

export function suggestExportBaseName(url: string): string {
  try {
    const u = new URL(url);
    const slug = u.pathname.split("/").filter(Boolean).pop() || "response";
    return slug.replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 48);
  } catch {
    return "response";
  }
}