import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { getRepoRoot } from "./repo";

function sanitizeCaseName(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 64) || "captured-case";
}

/** 读取 projects/<id>/cases/<name>.yaml（先精确文件名，再 sanitize 兜底） */
export async function readProjectCase(projectId: string, caseName: string): Promise<string | null> {
  const trimmed = caseName.trim();
  if (!trimmed) return null;
  const casesDir = path.join(getRepoRoot(), "projects", projectId, "cases");
  const candidates = [
    path.join(casesDir, `${trimmed}.yaml`),
    path.join(casesDir, `${sanitizeCaseName(trimmed)}.yaml`),
  ];
  for (const caseFile of candidates) {
    try {
      return await fs.readFile(caseFile, "utf8");
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function projectCaseExists(projectId: string, caseName: string): Promise<boolean> {
  const id = sanitizeCaseName(caseName);
  const caseFile = path.join(getRepoRoot(), "projects", projectId, "cases", `${id}.yaml`);
  try {
    await fs.access(caseFile);
    return true;
  } catch {
    return false;
  }
}

export async function saveProjectCase(
  projectId: string,
  caseName: string,
  yamlContent: string,
  options?: { addToSuite?: string; overwrite?: boolean },
): Promise<{ ok: boolean; error?: string; relativePath?: string; caseName?: string; exists?: boolean }> {
  const id = sanitizeCaseName(caseName);
  const projectDir = path.join(getRepoRoot(), "projects", projectId);
  const casesDir = path.join(projectDir, "cases");
  await fs.mkdir(casesDir, { recursive: true });
  const caseFile = path.join(casesDir, `${id}.yaml`);
  let exists = false;
  try {
    await fs.access(caseFile);
    exists = true;
    if (!options?.overwrite) {
      return { ok: false, exists: true, error: `用例已存在：${id}.yaml`, caseName: id };
    }
  } catch {
    // new file
  }
  await fs.writeFile(caseFile, yamlContent.endsWith("\n") ? yamlContent : `${yamlContent}\n`, "utf8");

  const suiteName = options?.addToSuite?.trim();
  if (suiteName) {
    const suitePath = path.join(projectDir, "suites", `${sanitizeCaseName(suiteName)}.yaml`);
    let doc: { cases?: string[]; name?: string } = { name: suiteName, cases: [] };
    try {
      const text = await fs.readFile(suitePath, "utf8");
      doc = yaml.load(text) as typeof doc;
      doc.cases = doc.cases ?? [];
    } catch {
      await fs.mkdir(path.dirname(suitePath), { recursive: true });
    }
    if (!doc.cases!.includes(id)) {
      doc.cases!.push(id);
      await fs.writeFile(suitePath, yaml.dump(doc), "utf8");
    }
  }

  return { ok: true, relativePath: `projects/${projectId}/cases/${id}.yaml`, caseName: id };
}

export async function updateProjectCase(
  projectId: string,
  caseName: string,
  yamlContent: string,
): Promise<{ ok: boolean; error?: string; relativePath?: string }> {
  const id = sanitizeCaseName(caseName);
  const caseFile = path.join(getRepoRoot(), "projects", projectId, "cases", `${id}.yaml`);
  try {
    await fs.access(caseFile);
  } catch {
    return { ok: false, error: `用例不存在：${id}.yaml` };
  }
  await fs.writeFile(caseFile, yamlContent.endsWith("\n") ? yamlContent : `${yamlContent}\n`, "utf8");
  return { ok: true, relativePath: `projects/${projectId}/cases/${id}.yaml` };
}

export async function deleteProjectCase(
  projectId: string,
  caseName: string,
): Promise<{ ok: boolean; error?: string }> {
  const id = sanitizeCaseName(caseName);
  const projectDir = path.join(getRepoRoot(), "projects", projectId);
  const caseFile = path.join(projectDir, "cases", `${id}.yaml`);
  try {
    await fs.unlink(caseFile);
  } catch {
    return { ok: false, error: `用例不存在或无法删除：${id}.yaml` };
  }

  const suitesDir = path.join(projectDir, "suites");
  let suiteFiles: string[] = [];
  try {
    suiteFiles = (await fs.readdir(suitesDir)).filter((f) => f.endsWith(".yaml"));
  } catch {
    return { ok: true };
  }
  for (const f of suiteFiles) {
    const suitePath = path.join(suitesDir, f);
    try {
      const text = await fs.readFile(suitePath, "utf8");
      const doc = yaml.load(text) as { cases?: string[] };
      const cases = doc.cases ?? [];
      if (!cases.includes(id)) continue;
      doc.cases = cases.filter((c) => c !== id);
      await fs.writeFile(suitePath, yaml.dump(doc), "utf8");
    } catch {
      // skip broken suite file
    }
  }
  return { ok: true };
}