import fs from "node:fs/promises";
import path from "node:path";

import { getRepoRoot } from "./repo";

export function projectSubdir(projectId: string, subdir: string): string {
  return path.join(getRepoRoot(), "projects", projectId.trim(), subdir);
}

export async function listJsonFilesInProjectSubdir(
  projectId: string,
  subdir: string,
): Promise<{ absoluteDir: string; files: string[] }> {
  const absoluteDir = projectSubdir(projectId, subdir);
  await fs.mkdir(absoluteDir, { recursive: true });
  let files: string[] = [];
  try {
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a));
  } catch {
    files = [];
  }
  return { absoluteDir, files };
}

async function jmxFromJmeterLogBesideJtl(jtlPath: string): Promise<string | null> {
  const logPath = path.join(path.dirname(path.resolve(jtlPath)), "jmeter.log");
  try {
    const text = await fs.readFile(logPath, "utf8");
    const m = text.match(/Loading file:\s*(.+\.jmx)/i);
    const candidate = m?.[1]?.trim();
    if (!candidate) return null;
    await fs.access(candidate);
    return path.resolve(candidate);
  } catch {
    return null;
  }
}

/** JTL 所在目录及其上一级目录中的 .jmx（同级 run_* 输出时 JMX 多在父目录） */
export async function findJmxFilesNearJtl(jtlPath: string): Promise<string[]> {
  const resolved = path.resolve(jtlPath.trim());
  const dirs = [path.dirname(resolved), path.dirname(path.dirname(resolved))];
  const seen = new Set<string>();
  const out: string[] = [];

  const fromLog = await jmxFromJmeterLogBesideJtl(resolved);
  if (fromLog) {
    seen.add(fromLog);
    out.push(fromLog);
  }

  const score = (fileName: string): number => {
    const n = fileName.toLowerCase();
    if (n.startsWith("loadtest-")) return 0;
    if (n.startsWith("测试计划")) return 1;
    return 2;
  };

  for (const dir of dirs) {
    let entries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith(".jmx")) continue;
      const full = path.join(dir, e.name);
      if (seen.has(full)) continue;
      seen.add(full);
      out.push(full);
    }
  }

  out.sort((a, b) => {
    const sa = score(path.basename(a));
    const sb = score(path.basename(b));
    if (sa !== sb) return sa - sb;
    return b.localeCompare(a);
  });
  return out;
}

export async function listJmxFilesInProject(projectId: string): Promise<{ absoluteDir: string; files: string[] }> {
  const absoluteDir = projectSubdir(projectId, "jmx");
  await fs.mkdir(absoluteDir, { recursive: true });
  let files: string[] = [];
  try {
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".jmx"))
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a));
  } catch {
    files = [];
  }
  return { absoluteDir, files };
}

export async function findJmeterResultJtlFiles(projectId: string): Promise<string[]> {
  const root = projectSubdir(projectId, "jmx");
  const out: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 5) return;
    let entries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (e.isFile() && e.name.toLowerCase() === "results.jtl") {
        out.push(full);
      }
    }
  }

  await walk(root, 0);
  out.sort((a, b) => b.localeCompare(a));
  return out;
}