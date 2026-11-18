import type { HttpBenchmarkReport } from "../../shared/apiWorkbenchTypes";
import { emptyRow } from "./apiWorkbenchModel";
import { buildJmxFromWorkbenchDrafts } from "./jmxExport";

function basenamePath(p: string): string {
  return p.replace(/^.*[\\/]/, "");
}

function repoRelativeToAbsolute(repoRoot: string, relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);
  const sep = repoRoot.includes("\\") ? "\\" : "/";
  return [repoRoot.replace(/[/\\]+$/, ""), ...parts].join(sep);
}

async function readFileIfExists(absPath: string): Promise<string | null> {
  const text = await window.atp.readAbsoluteFile(absPath);
  return text?.trim() ? text : null;
}

function jmxBaseFromReportName(report: HttpBenchmarkReport): string | null {
  const name = report.request.name?.trim() ?? "";
  const m = name.match(/^JMeter\s*[·•]\s*(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

function suggestedJmxFileName(report: HttpBenchmarkReport): string {
  const stamp = report.startedAt.replace(/[:.]/g, "-").slice(0, 19);
  const fromName = jmxBaseFromReportName(report);
  if (fromName) return `${fromName}.jmx`;
  const slug = (report.request.name || report.id).replace(/[<>:"/\\|?*]+/g, "_").slice(0, 48);
  return `perf-${stamp}-${slug}.jmx`;
}

function jmeterArchiveStamps(report: HttpBenchmarkReport): string[] {
  const out: string[] = [];
  const fromId = report.id.match(/^jmeter-(\d{4}-\d{2}-\d{2}T[\d-]+)-/i)?.[1];
  if (fromId) out.push(fromId);
  const fromStarted = report.startedAt.replace(/[:.]/g, "-").slice(0, 19);
  if (fromStarted && !out.includes(fromStarted)) out.push(fromStarted);
  return out;
}

function isGenericJtlPlanName(jmxBase: string | null): boolean {
  if (!jmxBase) return true;
  const g = jmxBase.toLowerCase();
  return g === "results" || g === "result" || g === "results.jtl";
}

function rebuildJmxFromReport(report: HttpBenchmarkReport): { xml: string; error?: string } {
  const method = report.request.method.toUpperCase();
  if (method === "JMX") {
    return { xml: "", error: "未在 JTL 旁或项目 jmx 目录找到关联的 JMX 文件" };
  }
  const built = buildJmxFromWorkbenchDrafts(
    [
      {
        label: report.request.name?.trim() || `${method} ${report.request.url}`,
        draft: {
          method: report.request.method,
          url: report.request.url,
          name: report.request.name,
          headers: [emptyRow()],
          query: [emptyRow()],
          bodyMode: "none",
          body: "",
        },
      },
    ],
    {
      planName: `历史存档 · ${report.startedAt.replace("T", " ").slice(0, 19)}`,
      threadGroupName: "线程组",
      threads: Math.max(1, report.options.concurrency ?? 1),
      rampUpSec: report.options.rampUpSec ?? 0,
      loops: Math.max(1, report.options.loops ?? 1),
      envName: "dev",
      injectEnv: false,
      includeAggregateListener: false,
    },
  );
  if (!built.xml) {
    return { xml: "", error: built.errors.join("；") || "无法根据历史记录生成 JMX" };
  }
  return { xml: built.xml };
}

export async function resolvePerfReportJmxXml(
  projectId: string,
  report: HttpBenchmarkReport,
): Promise<{ xml: string; suggestedName: string; rebuilt?: boolean } | { error: string }> {
  const { repoRoot } = await window.atp.getWorkspace();
  const candidates: string[] = [];

  if (report.provenance?.jmxPath?.trim()) {
    candidates.push(report.provenance.jmxPath.trim());
  }
  if (report.provenance?.jmxRelative?.trim()) {
    candidates.push(repoRelativeToAbsolute(repoRoot, report.provenance.jmxRelative.trim()));
  }

  const jmxBase = jmxBaseFromReportName(report);
  if (jmxBase) {
    const rel = `projects/${projectId}/jmx/${jmxBase}.jmx`;
    candidates.push(repoRelativeToAbsolute(repoRoot, rel));
    if (!jmxBase.toLowerCase().endsWith(".jmx")) {
      candidates.push(repoRelativeToAbsolute(repoRoot, `projects/${projectId}/jmx/${jmxBase}`));
    }
  }

  const jtlSource =
    report.provenance?.sourceJtl?.trim() ||
    (report.request.method.toUpperCase() === "JMX" && report.request.url.toLowerCase().endsWith(".jtl")
      ? report.request.url.trim()
      : "");
  if (jtlSource) {
    const near = await window.atp.findJmxFilesNearJtl(jtlSource);
    candidates.push(...near);
  }

  for (const stamp of jmeterArchiveStamps(report)) {
    candidates.push(
      repoRelativeToAbsolute(repoRoot, `projects/${projectId}/jmx/loadtest-${stamp}.jmx`),
    );
  }

  if (isGenericJtlPlanName(jmxBase)) {
    const projectJmx = await window.atp.listProjectJmxFiles(projectId);
    const stamps = jmeterArchiveStamps(report).map((s) => s.slice(0, 16));
    const ranked = projectJmx
      .filter((p) => /loadtest-/i.test(basenamePath(p)))
      .sort((a, b) => {
        const ba = basenamePath(a).toLowerCase();
        const bb = basenamePath(b).toLowerCase();
        const hit = (name: string) => stamps.some((s) => name.includes(s));
        const ha = hit(ba) ? 0 : 1;
        const hb = hit(bb) ? 0 : 1;
        if (ha !== hb) return ha - hb;
        return bb.localeCompare(ba);
      });
    candidates.push(...ranked.slice(0, 8));
  }

  const seen = new Set<string>();
  const uniqueCandidates = candidates.filter((abs) => {
    const key = abs.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(abs.trim());
  });

  for (const abs of uniqueCandidates) {
    const xml = await readFileIfExists(abs);
    if (xml) {
      return { xml, suggestedName: basenamePath(abs) || suggestedJmxFileName(report) };
    }
  }

  const rebuilt = rebuildJmxFromReport(report);
  if (rebuilt.xml) {
    return {
      xml: rebuilt.xml,
      suggestedName: suggestedJmxFileName(report),
      rebuilt: true,
    };
  }
  return { error: rebuilt.error ?? "未找到 JMX 文件" };
}