import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { getRepoRoot } from "./repo";
import { ensureCollection } from "./collectionStore";

function sanitizeProjectId(id: string): string {
  const s = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 48);
}

export async function createProject(opts: {
  id: string;
  name?: string;
  baseUrl?: string;
}): Promise<{ ok: boolean; error?: string; projectId?: string }> {
  const projectId = sanitizeProjectId(opts.id);
  if (!projectId) return { ok: false, error: "项目 ID 无效" };

  const projectDir = path.join(getRepoRoot(), "projects", projectId);
  try {
    await fs.access(projectDir);
    return { ok: false, error: `项目已存在：${projectId}` };
  } catch {
    // new
  }

  await fs.mkdir(path.join(projectDir, "cases"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "suites"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "environments"), { recursive: true });

  const displayName = opts.name?.trim() || projectId;
  const projectYaml = yaml.dump({
    name: displayName,
    description: "通过桌面端创建",
    default_environment: "dev",
  });
  await fs.writeFile(path.join(projectDir, "project.yaml"), projectYaml, "utf8");

  const baseUrl = opts.baseUrl?.trim() || "https://example.com";
  const envYaml = yaml.dump({
    name: "dev",
    variables: { base_url: baseUrl },
  });
  await fs.writeFile(path.join(projectDir, "environments", "dev.yaml"), envYaml, "utf8");

  const suiteYaml = yaml.dump({
    name: "smoke",
    description: "冒烟套件",
    cases: [] as string[],
  });
  await fs.writeFile(path.join(projectDir, "suites", "smoke.yaml"), suiteYaml, "utf8");

  await ensureCollection(projectId, "default");

  return { ok: true, projectId };
}

export async function deleteProject(
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  const id = sanitizeProjectId(projectId);
  if (!id) return { ok: false, error: "项目 ID 无效" };
  const projectDir = path.join(getRepoRoot(), "projects", id);
  try {
    await fs.access(projectDir);
  } catch {
    return { ok: false, error: "项目不存在" };
  }
  try {
    await fs.rm(projectDir, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}