import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { readProjectCase } from "./caseStore";
import { getCollection } from "./collectionStore";
import { getRepoRoot, pythonExecutable } from "./repo";
import { runPython } from "./pythonRun";

const CASE_REQUEST_PREFIX = "case:";

export type SuiteRunTarget =
  | { kind: "case"; key: string; id: string; label: string }
  | {
      kind: "collection";
      key: string;
      collectionId: string;
      requestId: string;
      label: string;
    };

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

function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmp = `${filePath}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmp, payload, "utf8");
  await fs.rename(tmp, filePath);
}

async function purgeRunsFromMonthIndex(repoRoot: string, idSet: Set<string>): Promise<void> {
  const monthDir = path.join(repoRoot, "runs", "by-month");
  let files: string[] = [];
  try {
    files = (await fs.readdir(monthDir)).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  for (const file of files) {
    const monthPath = path.join(monthDir, file);
    const monthDoc = await readJson<{ version?: number; month?: string; runs?: Array<{ id: string }> }>(
      monthPath,
      { runs: [] },
    );
    const before = monthDoc.runs?.length ?? 0;
    monthDoc.runs = (monthDoc.runs ?? []).filter((r) => !idSet.has(r.id));
    if ((monthDoc.runs?.length ?? 0) !== before) {
      await atomicWriteJson(monthPath, monthDoc);
    }
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
  caseTexts: Record<string, string>;
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
  const cases = await readDir("cases");
  const caseTexts: Record<string, string> = {};
  for (const name of cases) {
    const text = await readProjectCase(projectId, name);
    if (text != null) caseTexts[name] = text;
  }
  return {
    environments: await readDir("environments"),
    suites: await readDir("suites"),
    cases,
    caseTexts,
  };
}

export async function getSuiteCases(
  projectId: string,
  suiteName: string,
): Promise<{ name: string; description?: string; cases: string[] }> {
  const suitePath = path.join(getRepoRoot(), "projects", projectId, "suites", `${suiteName}.yaml`);
  try {
    const text = await fs.readFile(suitePath, "utf8");
    const doc = yaml.load(text) as { name?: string; description?: string; cases?: unknown[] };
    return {
      name: String(doc.name ?? suiteName),
      description: doc.description ? String(doc.description) : undefined,
      cases: Array.isArray(doc.cases) ? doc.cases.map((c) => String(c)) : [],
    };
  } catch {
    return { name: suiteName, cases: [] };
  }
}

export async function listSuiteRunTargets(
  projectId: string,
  suiteName: string,
): Promise<{ name: string; description?: string; targets: SuiteRunTarget[] }> {
  const suite = await getSuiteCases(projectId, suiteName);
  const suiteCaseSet = new Set(suite.cases);
  const targets: SuiteRunTarget[] = [];

  for (const id of suite.cases) {
    let label = id;
    const casePath = path.join(getRepoRoot(), "projects", projectId, "cases", `${id}.yaml`);
    try {
      const text = await fs.readFile(casePath, "utf8");
      const doc = yaml.load(text) as { name?: string; description?: string };
      label = String(doc.description ?? doc.name ?? id);
    } catch {
      // keep id
    }
    targets.push({ kind: "case", key: `case:${id}`, id, label });
  }

  const collectionsDir = path.join(getRepoRoot(), "projects", projectId, "collections");
  let files: string[] = [];
  try {
    files = (await fs.readdir(collectionsDir)).filter((f) => f.endsWith(".json"));
  } catch {
    return { name: suite.name, description: suite.description, targets };
  }

  for (const file of files) {
    const collectionId = file.replace(/\.json$/, "");
    const doc = await getCollection(projectId, collectionId);
    if (!doc?.requests?.length) continue;
    for (const req of doc.requests) {
      if (req.id.startsWith(CASE_REQUEST_PREFIX)) {
        const caseId = req.id.slice(CASE_REQUEST_PREFIX.length);
        if (suiteCaseSet.has(caseId)) {
          const idx = targets.findIndex((t) => t.kind === "case" && t.id === caseId);
          if (idx >= 0) {
            const cur = targets[idx];
            if (cur.kind === "case") {
              targets[idx] = {
                ...cur,
                label: req.name?.trim() || cur.label,
              };
            }
          }
        }
        continue;
      }
      targets.push({
        kind: "collection",
        key: `col:${collectionId}:${req.id}`,
        collectionId,
        requestId: req.id,
        label: req.name?.trim() || req.url || req.id,
      });
    }
  }

  return { name: suite.name, description: suite.description, targets };
}

export async function readTextFile(relativePath: string): Promise<string | null> {
  const full = path.join(getRepoRoot(), relativePath);
  try {
    return await fs.readFile(full, "utf8");
  } catch {
    return null;
  }
}

/** index.json 为空时，从 runs/<id>/summary.json 回填索引 */
async function rebuildRunsIndexFromDisk(repoRoot: string): Promise<RunIndexEntry[]> {
  const runsDir = path.join(repoRoot, "runs");
  const entries: RunIndexEntry[] = [];
  let dirEntries: string[] = [];
  try {
    dirEntries = await fs.readdir(runsDir);
  } catch {
    return [];
  }
  for (const name of dirEntries) {
    if (name === "index.json" || name === "by-month") continue;
    const summaryPath = path.join(runsDir, name, "summary.json");
    try {
      const summary = await readJson<{
        id?: string;
        project?: string;
        suite?: string;
        environment?: string;
        status?: string;
        started_at?: string;
      } | null>(summaryPath, null);
      if (!summary?.id || !summary.started_at) continue;
      entries.push({
        id: summary.id,
        project: summary.project ?? "",
        suite: summary.suite ?? "",
        environment: summary.environment ?? "",
        status: summary.status ?? "error",
        started_at: summary.started_at,
        dir: `runs/${summary.id}`,
      });
    } catch {
      // skip broken run dir
    }
  }
  entries.sort((a, b) => (b.started_at || "").localeCompare(a.started_at || ""));
  if (!entries.length) return [];
  const indexPath = path.join(runsDir, "index.json");
  await atomicWriteJson(indexPath, {
    version: 1,
    updated_at: utcNowIso(),
    runs: entries,
  });
  return entries;
}

export async function listRuns(filter?: {
  project?: string;
  status?: string;
  limit?: number;
}): Promise<RunIndexEntry[]> {
  const repoRoot = getRepoRoot();
  const indexPath = path.join(repoRoot, "runs", "index.json");
  const index = await readJson<{ runs?: RunIndexEntry[] }>(indexPath, { runs: [] });
  let runs = index.runs ?? [];
  if (!runs.length) {
    const rebuilt = await rebuildRunsIndexFromDisk(repoRoot);
    if (rebuilt.length) runs = rebuilt;
  }
  if (filter?.project) runs = runs.filter((r) => r.project === filter.project);
  if (filter?.status) runs = runs.filter((r) => r.status === filter.status);
  const limit = filter?.limit ?? 200;
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

export async function deleteRuns(runIds: string[]): Promise<{
  ok: boolean;
  deleted: number;
  errors: string[];
}> {
  const ids = [...new Set(runIds.filter(Boolean))];
  if (!ids.length) return { ok: true, deleted: 0, errors: [] };

  const idSet = new Set(ids);
  const repoRoot = getRepoRoot();
  const errors: string[] = [];
  let deleted = 0;

  for (const id of ids) {
    const runDir = path.join(repoRoot, "runs", id);
    try {
      await fs.rm(runDir, { recursive: true, force: true });
      deleted++;
    } catch {
      errors.push(`无法删除 runs/${id}`);
    }
  }

  const indexPath = path.join(repoRoot, "runs", "index.json");
  const index = await readJson<{ version?: number; updated_at?: string; runs?: RunIndexEntry[] }>(
    indexPath,
    { version: 1, runs: [] },
  );
  index.runs = (index.runs ?? []).filter((r) => !idSet.has(r.id));
  index.updated_at = utcNowIso();
  if (index.version == null) index.version = 1;
  await atomicWriteJson(indexPath, index);

  await purgeRunsFromMonthIndex(repoRoot, idSet);

  return { ok: errors.length === 0, deleted, errors };
}

export async function clearAllRuns(): Promise<{ ok: boolean; deleted: number; error?: string }> {
  const repoRoot = getRepoRoot();
  const runsDir = path.join(repoRoot, "runs");
  const indexPath = path.join(runsDir, "index.json");
  let deleted = 0;

  try {
    const entries = await fs.readdir(runsDir);
    for (const entry of entries) {
      if (entry === "index.json" || entry === "by-month") continue;
      const full = path.join(runsDir, entry);
      try {
        const stat = await fs.stat(full);
        if (stat.isDirectory()) {
          await fs.rm(full, { recursive: true, force: true });
          deleted++;
        }
      } catch {
        // skip missing or inaccessible
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "读取 runs 目录失败";
    return { ok: false, deleted, error: msg };
  }

  await atomicWriteJson(indexPath, { version: 1, updated_at: utcNowIso(), runs: [] });

  const monthDir = path.join(runsDir, "by-month");
  try {
    const monthFiles = (await fs.readdir(monthDir)).filter((f) => f.endsWith(".json"));
    for (const file of monthFiles) {
      const monthPath = path.join(monthDir, file);
      const monthDoc = await readJson<{ version?: number; month?: string; runs?: unknown[] }>(
        monthPath,
        {},
      );
      monthDoc.runs = [];
      await atomicWriteJson(monthPath, monthDoc);
    }
  } catch {
    // no by-month dir
  }

  return { ok: true, deleted };
}

export function runSuite(options: {
  project: string;
  suite: string;
  env: string;
  cases?: string[];
}): Promise<{ code: number; stdout: string; stderr: string }> {
  const args = [
    "-m",
    "atp.cli",
    "run",
    "-p",
    options.project,
    "-s",
    options.suite,
    "-e",
    options.env,
  ];
  for (const caseName of options.cases ?? []) {
    args.push("--case", caseName);
  }
  return runPython(args);
}

export async function getWorkspaceInfo(): Promise<{ repoRoot: string; python: string }> {
  const repoRoot = getRepoRoot();
  return { repoRoot, python: pythonExecutable(repoRoot) };
}

export async function getProjectVariables(
  projectId: string,
  envName: string,
): Promise<Record<string, string>> {
  const envDir = path.join(getRepoRoot(), "projects", projectId, "environments");
  const basePath = path.join(envDir, `${envName}.yaml`);
  const localPath = path.join(envDir, `${envName}.local.yaml`);
  const variables: Record<string, string> = { project: projectId };
  for (const filePath of [basePath, localPath]) {
    try {
      const text = await fs.readFile(filePath, "utf8");
      const doc = yaml.load(text) as { variables?: Record<string, unknown> };
      for (const [k, v] of Object.entries(doc.variables ?? {})) {
        variables[String(k)] = String(v).trim();
      }
    } catch {
      // missing env file
    }
  }
  return variables;
}