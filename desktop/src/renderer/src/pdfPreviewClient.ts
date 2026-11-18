/** 与主进程 perfReportStore.PDF_PREVIEW_NAME_PREFIX 一致 */
const PDF_PREVIEW_NAME_PREFIX = "__atp_preview__|";

export async function previewDashboardPdf(
  html: string,
  suggestedFileName: string,
  projectId: string,
): Promise<{ ok: boolean; pdfPath?: string; pdfFilePath?: string; error?: string }> {
  const atp = window.atp;
  if (typeof atp.previewReportPdf === "function") {
    return atp.previewReportPdf(html, suggestedFileName);
  }
  const pid = projectId.trim() || "_preview";
  const res = await atp.exportPerfReportPdfDialog(pid, html, `${PDF_PREVIEW_NAME_PREFIX}${suggestedFileName}`);
  if (!res.ok) return { ok: false, error: res.error ?? "预览失败" };
  if (res.cancelled) return { ok: false, error: "已取消预览" };
  return { ok: true, pdfPath: res.pdfFilePath, pdfFilePath: res.pdfFilePath };
}