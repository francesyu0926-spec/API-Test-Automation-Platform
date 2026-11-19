/**
 * 运行组件寻址：用户指定 → 安装包内置 runtime → 系统环境（PATH / JMETER_HOME）。
 * 与交付文档「三、主程序寻址逻辑改造」一致。
 */
import fs from "node:fs";
import path from "node:path";

import { getBundledJmeterHome, getBundledPythonExe } from "./bundledRuntime";

export type RuntimePathOverrides = {
  pythonExe?: string;
  jmeterHome?: string;
};

export type PythonResolveSource =
  | "user-override"
  | "bundled"
  | "project-venv"
  | "system-path";

export type PythonResolveResult = {
  executable: string;
  source: PythonResolveSource;
};

function repoRootFromEnv(): string | undefined {
  const fromEnv = process.env.ATP_REPO_ROOT?.trim();
  return fromEnv ? path.resolve(fromEnv) : undefined;
}

function overridesFile(repoRoot: string): string {
  return path.join(repoRoot, "data", "runtime-paths.json");
}

function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 第一顺位：偏好文件 + ATP_PYTHON(_EXE) */
export function readRuntimePathOverrides(repoRoot?: string): RuntimePathOverrides {
  const root = repoRoot ?? repoRootFromEnv();
  const out: RuntimePathOverrides = {};
  const pyEnv = process.env.ATP_PYTHON_EXE?.trim() || process.env.ATP_PYTHON?.trim();
  if (pyEnv) out.pythonExe = pyEnv;

  if (!root) return out;

  const cfgPath = overridesFile(root);
  if (fileExists(cfgPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as RuntimePathOverrides;
      if (raw.pythonExe?.trim()) out.pythonExe = raw.pythonExe.trim();
      if (raw.jmeterHome?.trim()) out.jmeterHome = raw.jmeterHome.trim();
    } catch {
      /* ignore corrupt file */
    }
  }
  return out;
}

function validPythonExe(candidate: string | undefined): string | null {
  const c = candidate?.trim();
  if (!c) return null;
  if (fileExists(c)) return path.resolve(c);
  return null;
}

/**
 * Python 解析顺序：
 * 1. userOverride / data/runtime-paths.json / ATP_PYTHON(_EXE)
 * 2. resources/runtime 或 runtime-dev 下 python.exe
 * 3. 项目 .venv，最后回退 PATH 上的 python / python3
 */
export function resolvePythonPath(
  repoRoot: string,
  userOverride?: string,
): PythonResolveResult {
  const saved = readRuntimePathOverrides(repoRoot);
  const fromUser =
    validPythonExe(userOverride) ??
    validPythonExe(saved.pythonExe);
  if (fromUser) {
    return { executable: fromUser, source: "user-override" };
  }

  const bundled = getBundledPythonExe();
  if (bundled) {
    return { executable: bundled, source: "bundled" };
  }

  const win = path.join(repoRoot, ".venv", "Scripts", "python.exe");
  const unix = path.join(repoRoot, ".venv", "bin", "python");
  if (process.platform === "win32" && fileExists(win)) {
    return { executable: win, source: "project-venv" };
  }
  if (fileExists(unix)) {
    return { executable: unix, source: "project-venv" };
  }

  const fallback = process.platform === "win32" ? "python" : "python3";
  return { executable: fallback, source: "system-path" };
}

/** JMeter 用户指定目录（UI / 配置文件），不含内置与环境回退 */
export function userJmeterHomeOverride(callSite: string | undefined, repoRoot: string): string | undefined {
  const trimmed = callSite?.trim();
  if (trimmed) return trimmed;
  const saved = readRuntimePathOverrides(repoRoot).jmeterHome?.trim();
  return saved || undefined;
}

/** 第二顺位：内置 jmeter 目录 */
export function bundledJmeterHome(): string | null {
  return getBundledJmeterHome();
}