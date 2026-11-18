import { dialog, type BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

import type { HttpBenchmarkReport } from "../shared/apiWorkbenchTypes";
import { renderHtmlToPdf } from "./perfReportPdf";
import { getRepoRoot } from "./repo";

function perfDir(projectId: string): string {
  return path.join(getRepoRoot(), "projects", projectId, "perf");
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
    const base = path.basename(file);
    if (!base.endsWith(".json") || base !== file) continue;
    try {
      const text = await fs.readFile(path.join(dir, base), "utf8");
      out.push(JSON.parse(text) as HttpBenchmarkReport);
    } catch {
      // skip
    }
  }
  return out;
}

export async function exportPerfReportPdfDialog(
  projectId: string,
  visualHtml: string,
  suggestedFileName: string,
  parentWindow: BrowserWindow | null,
): Promise<{ ok: boolean; pdfFilePath?: string; cancelled?: boolean; error?: string }> {
  if (!visualHtml.trim()) return { ok: false, error: "报告内容为空" };
  if (!parentWindow) return { ok: false, error: "无活动窗口，无法打开另存为对话框" };
  await fs.mkdir(perfDir(projectId), { recursive: true });
  const safeName = suggestedFileName.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, "-");
  const defaultPdf = path.join(perfDir(projectId), safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`);
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

export async function listPerfReports(
  projectId: string,
  limit = 50,
): Promise<
  Array<{
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
  }>
> {
  const dir = perfDir(projectId);
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  files.sort().reverse();
  const out: Array<{
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
  }> = [];
  for (const file of files.slice(0, limit)) {
    try {
      const text = await fs.readFile(path.join(dir, file), "utf8");
      const doc = JSON.parse(text) as HttpBenchmarkReport;
      out.push({
        id: doc.id,
        file,
        startedAt: doc.startedAt,
        method: doc.request.method,
        url: doc.request.url,
        name: doc.request.name,
        samples: doc.stats.samples,
        success: doc.stats.success,
        failed: doc.stats.failed,
        rps: doc.stats.rps,
      });
    } catch {
      // skip corrupt
    }
  }
  return out;
}

export async function getPerfReportsDirInfo(
  projectId: string,
): Promise<{ absolute: string; relative: string }> {
  const absolute = perfDir(projectId);
  await fs.mkdir(absolute, { recursive: true });
  return { absolute, relative: `projects/${projectId}/perf` };
}

export async function deletePerfReports(
  projectId: string,
  files: string[],
): Promise<{ ok: boolean; deleted: number; error?: string }> {
  const dir = perfDir(projectId);
  let deleted = 0;
  for (const file of files) {
    const base = path.basename(file);
    if (!base.endsWith(".json") || base !== file) continue;
    try {
      await fs.unlink(path.join(dir, base));
      deleted += 1;
      const pdfBase = base.replace(/\.json$/, ".pdf");
      try {
        await fs.unlink(path.join(dir, pdfBase));
      } catch {
        /* optional pdf */
      }
    } catch {
      // skip missing
    }
  }
  return { ok: true, deleted };
}