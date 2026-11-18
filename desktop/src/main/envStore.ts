import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { getProjectVariables } from "./atpService";
import { getRepoRoot } from "./repo";

export function sanitizeEnvName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export async function saveProjectEnvLocal(
  projectId: string,
  envName: string,
  variables: Record<string, string>,
): Promise<{ ok: boolean; relativePath: string }> {
  const envDir = path.join(getRepoRoot(), "projects", projectId, "environments");
  await fs.mkdir(envDir, { recursive: true });
  const localPath = path.join(envDir, `${envName}.local.yaml`);
  const doc = { name: envName, variables };
  await fs.writeFile(localPath, yaml.dump(doc), "utf8");
  return { ok: true, relativePath: `projects/${projectId}/environments/${envName}.local.yaml` };
}

export async function createProjectEnvironment(
  projectId: string,
  envName: string,
  opts?: { copyFrom?: string; baseUrl?: string },
): Promise<{ ok: boolean; error?: string; envName?: string }> {
  const id = sanitizeEnvName(envName);
  if (!id) return { ok: false, error: "环境名无效（请使用字母、数字、-、_）" };

  const envDir = path.join(getRepoRoot(), "projects", projectId, "environments");
  const basePath = path.join(envDir, `${id}.yaml`);
  try {
    await fs.access(basePath);
    return { ok: false, error: `环境已存在：${id}` };
  } catch {
    // new
  }

  let variables: Record<string, string> = {
    base_url: opts?.baseUrl?.trim() || "https://example.com",
  };
  const copyFrom = opts?.copyFrom?.trim();
  if (copyFrom && copyFrom !== id) {
    const from = await getProjectVariables(projectId, copyFrom);
    for (const [k, v] of Object.entries(from)) {
      if (k === "project") continue;
      variables[k] = v;
    }
    if (opts?.baseUrl?.trim()) variables.base_url = opts.baseUrl.trim();
  }

  await fs.mkdir(envDir, { recursive: true });
  const doc = { name: id, variables };
  await fs.writeFile(basePath, yaml.dump(doc), "utf8");
  return { ok: true, envName: id };
}