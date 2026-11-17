import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { getRepoRoot, pythonExecutable } from "./repo";
import { runPython } from "./pythonRun";

export type ProjectSummary = {
  id: string;
  name: string;
  description?: string;
  defaultEnvironment?: string;
};

export type RunIndexEntry = {
  id: string;
  project: string;
  suite: string;
  environment: string;
  status: string;
  started_at: string;
  dir: string;
};

export type RunSummary = {
  id: string;
  project: string;
  suite: string;
  environment: string;
  status: string;
  started_at: string;
  finished_at: string;
  stats: { total: number; passed: number; failed: number };
};

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const root = getRepoRoot();
  const projectsDir = path.join(root, "projects");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(projectsDir);
  } catch {
    return [];
  }
  const out: ProjectSummary[] = [];
  for (const id of entries) {
    const projectFile = path.join(projectsDir, id, "project.yaml");
    try {
      const text = await fs.readFile(projectFile, "utf8");
      const doc = yaml.load(text) as Record<string, unknown>;
      out.push({
        id,
        name: String(doc.name ?? id),
        description: doc.description ? String(doc.description) : undefined,
        defaultEnvironment: doc.default_environment
          ? String(doc.default_environment)
          : undefined,
      });
    } catch {
      out.push({ id, name: id });
    }
  }
  return out;
}

export async function listProjectAssets(projectId: string): Promise<{
  environments: string[];
  suites: string[];
  cases: string[];
}> {
  const base = path.join(getRepoRoot(), "projects", projectId);
  const readDir = async (sub: string) => {
    try {
      const files = await fs.readdir(path.join(base, sub));
      return files
        .filter((f) => f.endsWith(".yaml") && !f.includes(".local."))
        .map((f) => f.replace(/\.yaml$/, ""));
    } catch {
      return [];
    }
  };
  return {
    environments: await readDir("environments"),
    suites: await readDir("suites"),
    cases: await readDir("cases"),
  };
}

export async function readTextFile(relativePath: string): Promise<string | null> {
  const full = path.join(getRepoRoot(), relativePath);
  try {
    return await fs.readFile(full, "utf8");
  } catch {
    return null;
  }
}

export async function listRuns(filter?: {
  project?: string;
  status?: string;
  limit?: number;
}): Promise<RunIndexEntry[]> {
  const indexPath = path.join(getRepoRoot(), "runs", "index.json");
  const index = await readJson<{ runs?: RunIndexEntry[] }>(indexPath, { runs: [] });
  let runs = index.runs ?? [];
  if (filter?.project) runs = runs.filter((r) => r.project === filter.project);
  if (filter?.status) runs = runs.filter((r) => r.status === filter.status);
  const limit = filter?.limit ?? 50;
  return runs.slice(0, limit);
}

export async function getRunDetail(runId: string): Promise<{
  summary: RunSummary | null;
  steps: unknown[];
}> {
  const runDir = path.join(getRepoRoot(), "runs", runId);
  const summary = await readJson<RunSummary | null>(
    path.join(runDir, "summary.json"),
    null,
  );
  const stepsDir = path.join(runDir, "steps");
  let stepFiles: string[] = [];
  try {
    stepFiles = (await fs.readdir(stepsDir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return { summary, steps: [] };
  }
  const steps: unknown[] = [];
  for (const f of stepFiles) {
    steps.push(await readJson(path.join(stepsDir, f), {}));
  }
  return { summary, steps };
}

export function runSuite(options: {
  project: string;
  suite: string;
  env: string;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  return runPython([
    "-m",
    "atp.cli",
    "run",
    "-p",
    options.project,
    "-s",
    options.suite,
    "-e",
    options.env,
  ]);
}

export async function getWorkspaceInfo(): Promise<{ repoRoot: string; python: string }> {
  const repoRoot = getRepoRoot();
  return { repoRoot, python: pythonExecutable(repoRoot) };
}