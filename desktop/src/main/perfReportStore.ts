import { dialog, type BrowserWindow } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { HttpBenchmarkJtlEndpoint, HttpBenchmarkReport } from "../shared/apiWorkbenchTypes";
import { listJsonFilesInProjectSubdir, projectSubdir } from "./projectFs";
import { openPdfInNewTab } from "./pdfViewer";
import { renderHtmlToPdf } from "./perfReportPdf";
import { getRepoRoot } from "./repo";

/** 经 exportPerfReportPdfDialog 触发预览（兼容旧 preload 未含 previewReportPdf） */
export const PDF_PREVIEW_NAME_PREFIX = "__atp_preview__|";

function perfDir(projectId: string): string {
  return projectSubdir(projectId, "perf");
}

/** Accept bare filename or path; reject traversal outside perf dir. */
function resolvePerfArchivePath(dir: string, file: string, ext: "json" | "pdf"): string | null {
  const base = path.basename(file.trim());
  if (base.includes("..") || !base.toLowerCase().endsWith(`.${ext}`)) return null;
  const full = path.resolve(path.join(dir, base));
  const root = path.resolve(dir);
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

function resolvePerfJsonPath(dir: string, file: string): string | null {
  return resolvePerfArchivePath(dir, file, "json");
}

type PerfListRow = {
  id: string;
  file: string;
  startedAt: string;
  method: string;
  url: string;
  name?: string;
  samples: number;
  success: number;
  failed: number;
  rps: number;
  jtlEndpoints?: HttpBenchmarkJtlEndpoint[];
};

function perfListRowFromJson(file: string, doc: unknown): PerfListRow | null {
  if (!doc || typeof doc !== "object") return null;
  const raw = doc as Partial<HttpBenchmarkReport> & {
    request?: { method?: string; url?: string; name?: string };
    stats?: { samples?: number; success?: number; failed?: number; rps?: number };
    jtlEndpoints?: HttpBenchmarkJtlEndpoint[];
  };
  const request = raw.request;
  const stats = raw.stats;
  if (raw.id && raw.startedAt && request?.method && request?.url && stats) {
    return {
      id: raw.id,
      file,
      startedAt: raw.startedAt,
      method: request.method,
      url: request.url,
      name: request.name,
      samples: Number(stats.samples) || 0,
      success: Number(stats.success) || 0,
      failed: Number(stats.failed) || 0,
      rps: Number(stats.rps) || 0,
      jtlEndpoints: raw.jtlEndpoints,
    };
  }

  const stampMatch = file.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/i);
  const id = typeof raw.id === "string" ? raw.id : file.replace(/\.json$/i, "");
  return {
    id,
    file,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : stampMatch?.[1] ?? file,
    method: request?.method ?? "—",
    url: request?.url ?? "（无法解析报告 URL）",
    name: request?.name,
    samples: Number(stats?.samples) || 0,
    success: Number(stats?.success) || 0,
    failed: Number(stats?.failed) || 0,
    rps: Number(stats?.rps) || 0,
    jtlEndpoints: raw.jtlEndpoints,
  };
}

export async function savePerfReport(
  projectId: string,
  report: HttpBenchmarkReport,
  visualHtml: string | undefined,
  parentWindow: BrowserWindow | null,
): Promise<{
  ok: boolean;
  relativePath: string;
  pdfFilePath?: string;
  cancelled?: boolean;
  error?: string;
}> {
  const dir = perfDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const stamp = report.startedAt.replace(/[:.]/g, "-");
  const base = `${stamp}-${report.id}`;
  const file = `${base}.json`;
  const full = path.join(dir, file);
  await fs.writeFile(full, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const jsonRelative = `projects/${projectId}/perf/${file}`;

  if (!visualHtml?.trim()) {
    return { ok: true, relativePath: jsonRelative };
  }

  if (!parentWindow) {
    return { ok: true, relativePath: jsonRelative, error: "无活动窗口，无法打开另存为对话框" };
  }

  try {
    const pdf = await renderHtmlToPdf(visualHtml);
    const defaultPdf = path.join(dir, `${base}.pdf`);
    const { canceled, filePath } = await dialog.showSaveDialog(parentWindow, {
      title: "另存为压测报告",
      defaultPath: defaultPdf,
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
    });
    if (canceled || !filePath) {
      return { ok: true, relativePath: jsonRelative, cancelled: true };
    }
    await fs.writeFile(filePath, pdf);
    return { ok: true, relativePath: jsonRelative, pdfFilePath: filePath };
  } catch (e) {
    return {
      ok: true,
      relativePath: jsonRelative,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function loadPerfReports(
  projectId: string,
  files: string[],
): Promise<HttpBenchmarkReport[]> {
  const dir = perfDir(projectId);
  const out: HttpBenchmarkReport[] = [];
  for (const file of files) {
    const full = resolvePerfJsonPath(dir, file);
    if (!full) continue;
    try {
      const text = await fs.readFile(full, "utf8");
      out.push(JSON.parse(text) as HttpBenchmarkReport);
    } catch {
      // skip
    }
  }
  return out;
}

export async function ensurePerfReportPdf(
  projectId: string,
  jsonFile: string,
  visualHtml: string,
  options?: { forceRegenerate?: boolean },
): Promise<{ ok: boolean; pdfPath?: string; created?: boolean; regenerated?: boolean; error?: string }> {
  const dir = perfDir(projectId);
  const jsonFull = resolvePerfJsonPath(dir, jsonFile);
  if (!jsonFull) return { ok: false, error: "无效的历史记录文件名" };
  const pdfPath = jsonFull.replace(/\.json$/i, ".pdf");
  let exists = false;
  try {
    await fs.access(pdfPath);
    exists = true;
    if (!options?.forceRegenerate) {
      return { ok: true, pdfPath, created: false };
    }
  } catch {
    /* generate below */
  }
  if (!visualHtml.trim()) return { ok: false, error: "报告内容为空" };
  try {
    const pdf = await renderHtmlToPdf(visualHtml);
    await fs.writeFile(pdfPath, pdf);
    return {
      ok: true,
      pdfPath,
      created: !exists,
      regenerated: exists && Boolean(options?.forceRegenerate),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function sanitizePdfBaseName(suggestedFileName: string): string {
  return suggestedFileName.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, "-").slice(0, 96);
}

/** 生成 PDF 到临时目录，供预览窗口打开（自带缩放/打印/下载等操作） */
export async function previewReportPdfFromHtml(
  visualHtml: string,
  suggestedFileName: string,
): Promise<{ ok: boolean; pdfPath?: string; error?: string }> {
  if (!visualHtml.trim()) return { ok: false, error: "报告内容为空" };
  const safeName = sanitizePdfBaseName(suggestedFileName);
  const dir = path.join(os.tmpdir(), "atp-pdf-preview");
  try {
    await fs.mkdir(dir, { recursive: true });
    const pdf = await renderHtmlToPdf(visualHtml);
    const pdfPath = path.join(dir, `${safeName || "report"}-${Date.now()}.pdf`);
    await fs.writeFile(pdfPath, pdf);
    return { ok: true, pdfPath };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function exportPerfReportPdfDialog(
  projectId: string,
  visualHtml: string,
  suggestedFileName: string,
  parentWindow: BrowserWindow | null,
): Promise<{ ok: boolean; pdfFilePath?: string; cancelled?: boolean; error?: string; preview?: boolean }> {
  if (!visualHtml.trim()) return { ok: false, error: "报告内容为空" };

  if (suggestedFileName.startsWith(PDF_PREVIEW_NAME_PREFIX)) {
    const name = suggestedFileName.slice(PDF_PREVIEW_NAME_PREFIX.length);
    const built = await previewReportPdfFromHtml(visualHtml, name);
    if (!built.ok || !built.pdfPath) return { ok: false, error: built.error ?? "生成预览失败" };
    const opened = await openPdfInNewTab(built.pdfPath);
    if (!opened.ok) return { ok: false, error: opened.error ?? "无法打开 PDF 预览窗口" };
    return { ok: true, pdfFilePath: built.pdfPath, preview: true };
  }

  if (!parentWindow) return { ok: false, error: "无活动窗口，无法打开另存为对话框" };
  if (projectId?.trim()) await fs.mkdir(perfDir(projectId), { recursive: true });
  const safeName = sanitizePdfBaseName(suggestedFileName);
  const defaultPdf = projectId?.trim()
    ? path.join(perfDir(projectId), safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`)
    : path.join(os.tmpdir(), "atp-pdf-preview", safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`);
  try {
    const pdf = await renderHtmlToPdf(visualHtml);
    const { canceled, filePath } = await dialog.showSaveDialog(parentWindow, {
      title: "另存为压测报告",
      defaultPath: defaultPdf,
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
    });
    if (canceled || !filePath) return { ok: true, cancelled: true };
    await fs.writeFile(filePath, pdf);
    return { ok: true, pdfFilePath: filePath };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listPerfReports(projectId: string, limit = 50): Promise<PerfListRow[]> {
  if (!projectId?.trim()) return [];
  const { absoluteDir: dir, files } = await listJsonFilesInProjectSubdir(projectId, "perf");
  const out: PerfListRow[] = [];
  for (const file of files.slice(0, limit)) {
    try {
      const text = await fs.readFile(path.join(dir, file), "utf8");
      const doc = JSON.parse(text) as unknown;
      const row = perfListRowFromJson(file, doc);
      if (row) out.push(row);
    } catch {
      out.push({
        id: file.replace(/\.json$/i, ""),
        file,
        startedAt: file,
        method: "—",
        url: "（JSON 无法解析，请点击刷新或检查文件）",
        samples: 0,
        success: 0,
        failed: 0,
        rps: 0,
      });
    }
  }
  return out;
}

export async function getPerfReportsDirInfo(
  projectId: string,
): Promise<{ absolute: string; relative: string; jsonFileCount: number; repoRoot: string }> {
  const repoRoot = getRepoRoot();
  const id = projectId.trim();
  const { absoluteDir: absolute, files } = await listJsonFilesInProjectSubdir(id, "perf");
  return {
    absolute,
    relative: `projects/${id}/perf`,
    jsonFileCount: files.length,
    repoRoot,
  };
}

export async function deletePerfReports(
  projectId: string,
  files: string[],
): Promise<{ ok: boolean; deleted: number; error?: string }> {
  const dir = perfDir(projectId);
  let deleted = 0;
  const failures: string[] = [];
  let skipped = 0;
  for (const file of files) {
    const jsonPath = resolvePerfJsonPath(dir, file);
    if (!jsonPath) {
      skipped += 1;
      continue;
    }
    const base = path.basename(jsonPath);
    try {
      await fs.unlink(jsonPath);
      deleted += 1;
      const pdfPath = resolvePerfArchivePath(dir, base.replace(/\.json$/i, ".pdf"), "pdf");
      if (pdfPath) {
        try {
          await fs.unlink(pdfPath);
        } catch {
          /* optional pdf */
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${base}: ${msg}`);
    }
  }
  if (deleted === 0 && files.length > 0) {
    const detail = failures[0] ?? (skipped === files.length ? "所选文件名无效" : "文件不存在或无法删除（若文件在资源管理器中打开，请先关闭）");
    return { ok: false, deleted: 0, error: detail };
  }
  if (failures.length) {
    return {
      ok: true,
      deleted,
      error: `已删除 ${deleted} 条；${failures.length} 条失败：${failures.slice(0, 2).join("；")}`,
    };
  }
  return { ok: true, deleted };
}