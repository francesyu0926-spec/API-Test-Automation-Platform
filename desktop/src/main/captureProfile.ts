import fs from "node:fs/promises";
import path from "node:path";

import yaml from "js-yaml";

import { parseCaptureHostList } from "./captureHosts";
import { getRepoRoot } from "./repo";
import type { CapturePacPreset, ProjectCaptureProfile } from "../shared/captureProfile";

const ENV_URL_VARS = ["base_url", "api_url", "api_base_url", "host"];

function normalizePacHostsInput(raw: unknown): string[] {
  if (typeof raw === "string") return parseCaptureHostList(raw);
  if (Array.isArray(raw)) {
    return parseCaptureHostList(raw.map((x) => String(x)).join(","));
  }
  return [];
}

function hostMatchesProtected(bypassHost: string, protectedHost: string): boolean {
  const b = bypassHost.toLowerCase();
  const p = protectedHost.toLowerCase();
  if (b === p) return true;
  return b.endsWith(`.${p}`) || p.endsWith(`.${b}`);
}

async function readPlatformPacPresets(): Promise<CapturePacPreset[]> {
  const configPath = path.join(getRepoRoot(), "platform.config.yaml");
  try {
    const text = await fs.readFile(configPath, "utf8");
    const doc = yaml.load(text) as { capture?: { pac_presets?: unknown[] } };
    const rows = doc.capture?.pac_presets;
    if (!Array.isArray(rows)) return [];
    const out: CapturePacPreset[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const hosts = String(r.hosts ?? "").trim();
      if (!hosts) continue;
      const id = String(r.id ?? r.label ?? hosts.slice(0, 24)).trim() || "preset";
      const label = String(r.label ?? id).trim() || id;
      out.push({ id, label, hosts });
    }
    return out;
  } catch {
    return [];
  }
}

async function deriveHostsFromEnvironments(projectId: string, preferredEnv?: string): Promise<string[]> {
  const envDir = path.join(getRepoRoot(), "projects", projectId, "environments");
  let files: string[] = [];
  try {
    files = (await fs.readdir(envDir)).filter((f) => f.endsWith(".yaml") && !f.includes(".local."));
  } catch {
    return [];
  }
  const ordered = preferredEnv
    ? [...files.filter((f) => f === `${preferredEnv}.yaml`), ...files.filter((f) => f !== `${preferredEnv}.yaml`)]
    : files;
  const hosts: string[] = [];
  for (const file of ordered) {
    try {
      const text = await fs.readFile(path.join(envDir, file), "utf8");
      const doc = yaml.load(text) as { variables?: Record<string, unknown> };
      const vars = doc.variables ?? {};
      for (const key of ENV_URL_VARS) {
        const val = vars[key];
        if (typeof val === "string" && val.trim()) {
          hosts.push(...parseCaptureHostList(val));
        }
      }
    } catch {
      /* skip */
    }
  }
  return [...new Set(hosts)];
}

export async function getProjectCaptureProfile(projectId: string): Promise<ProjectCaptureProfile> {
  const presets = await readPlatformPacPresets();
  const empty: ProjectCaptureProfile = {
    pacHosts: [],
    pacHostsCsv: "",
    templateLabel: "项目 PAC 模板",
    presets,
  };
  if (!projectId) return empty;

  const projectFile = path.join(getRepoRoot(), "projects", projectId, "project.yaml");
  let doc: Record<string, unknown> = {};
  try {
    const text = await fs.readFile(projectFile, "utf8");
    doc = (yaml.load(text) as Record<string, unknown>) ?? {};
  } catch {
    const derived = await deriveHostsFromEnvironments(projectId);
    return {
      ...empty,
      pacHosts: derived,
      pacHostsCsv: derived.join(","),
    };
  }

  const capture =
    doc.capture && typeof doc.capture === "object" ? (doc.capture as Record<string, unknown>) : {};
  let pacHosts = normalizePacHostsInput(capture.pac_hosts ?? capture.pacHosts);
  const defaultEnv = doc.default_environment ? String(doc.default_environment) : undefined;
  if (!pacHosts.length) {
    pacHosts = await deriveHostsFromEnvironments(projectId, defaultEnv);
  }
  const templateLabel =
    typeof capture.template_label === "string" && capture.template_label.trim()
      ? capture.template_label.trim()
      : typeof capture.templateLabel === "string" && capture.templateLabel.trim()
        ? capture.templateLabel.trim()
        : "项目 PAC 模板";

  return {
    pacHosts,
    pacHostsCsv: pacHosts.join(","),
    templateLabel,
    presets,
  };
}

/** 内嵌「直连」列表若包含项目 API 域，则请求不会出现在抓包列表 */
export function embeddedBypassBlocksProtectedHosts(bypassInput: string, protectedHosts: string[]): string[] {
  if (!protectedHosts.length) return [];
  const bypass = parseCaptureHostList(bypassInput);
  return bypass.filter((h) => protectedHosts.some((p) => hostMatchesProtected(h, p)));
}