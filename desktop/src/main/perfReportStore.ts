import fs from "node:fs/promises";
import path from "node:path";

import type { HttpBenchmarkReport } from "../shared/apiWorkbenchTypes";
import { getRepoRoot } from "./repo";

function perfDir(projectId: string): string {
  return path.join(getRepoRoot(), "projects", projectId, "perf");
}

export async function savePerfReport(
  projectId: string,
  report: HttpBenchmarkReport,
): Promise<{ ok: boolean; relativePath: string }> {
  const dir = perfDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const stamp = report.startedAt.replace(/[:.]/g, "-");
  const file = `${stamp}-${report.id}.json`;
  const full = path.join(dir, file);
  await fs.writeFile(full, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { ok: true, relativePath: `projects/${projectId}/perf/${file}` };
}

export async function listPerfReports(
  projectId: string,
  limit = 20,
): Promise<Array<{ id: string; file: string; startedAt: string; method: string; url: string }>> {
  const dir = perfDir(projectId);
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  files.sort().reverse();
  const out: Array<{ id: string; file: string; startedAt: string; method: string; url: string }> = [];
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
      });
    } catch {
      // skip corrupt
    }
  }
  return out;
}