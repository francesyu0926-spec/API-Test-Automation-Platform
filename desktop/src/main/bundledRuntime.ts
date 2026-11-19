import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import { getRepoRoot } from "./repo";

export type BundledRuntimeManifest = {
  edition?: "full" | "standard";
  python?: { version?: string; path?: string };
  jre?: { version?: string; home?: string };
  jmeter?: { version?: string; home?: string };
  stagedAt?: string;
};

function existsDir(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function existsFile(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** `resources/runtime`（安装包）或开发期 `desktop/runtime-dev` */
export function bundledRuntimeRoot(): string | null {
  try {
    if (app.isPackaged) {
      const packaged = path.join(process.resourcesPath, "runtime");
      return existsDir(packaged) ? packaged : null;
    }
  } catch {
    /* ignore */
  }
  const dev = path.join(getRepoRoot(), "desktop", "runtime-dev");
  return existsDir(dev) ? dev : null;
}

export function readBundledRuntimeManifest(): BundledRuntimeManifest | null {
  const root = bundledRuntimeRoot();
  if (!root) return null;
  const manifestPath = path.join(root, "runtime-manifest.json");
  if (!existsFile(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BundledRuntimeManifest;
  } catch {
    return null;
  }
}

export function getBundledPythonExe(): string | null {
  const root = bundledRuntimeRoot();
  if (!root) return null;
  const win = path.join(root, "python", "python.exe");
  if (existsFile(win)) return win;
  const unix = path.join(root, "python", "bin", "python3");
  if (existsFile(unix)) return unix;
  return null;
}

/** 内置 JRE（JMeter 用，无需客户安装 Java） */
export function getBundledJreHome(): string | null {
  const root = bundledRuntimeRoot();
  if (!root) return null;
  const jre = path.join(root, "jre");
  const java =
    process.platform === "win32" ? path.join(jre, "bin", "java.exe") : path.join(jre, "bin", "java");
  if (!existsFile(java)) return null;
  return jre;
}

export function jmeterProcessEnv(jmeterHome: string, extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const jre = getBundledJreHome();
  return {
    ...process.env,
    ...extra,
    JMETER_HOME: jmeterHome,
    ...(jre ? { JAVA_HOME: jre, JRE_HOME: jre } : {}),
    JAVA_TOOL_OPTIONS: "-Dfile.encoding=UTF-8",
  };
}

export function getBundledJmeterHome(): string | null {
  const root = bundledRuntimeRoot();
  if (!root) return null;
  const home = path.join(root, "jmeter");
  const bin =
    process.platform === "win32"
      ? path.join(home, "bin", "jmeter.bat")
      : path.join(home, "bin", "jmeter");
  if (!existsFile(bin)) return null;
  return home;
}

/** 安装包内客户文档（PDF/HTML） */
export function getBundledDocsDir(): string | null {
  try {
    if (app.isPackaged) {
      const docs = path.join(process.resourcesPath, "docs");
      return existsDir(docs) ? docs : null;
    }
  } catch {
    /* ignore */
  }
  const fromRepo = path.join(getRepoRoot(), "docs");
  return existsDir(fromRepo) ? fromRepo : null;
}

export function getBundledProductManualPdf(): string | null {
  const dir = getBundledDocsDir();
  if (!dir) return null;
  const pdf = path.join(dir, "PRODUCT-MANUAL.pdf");
  return existsFile(pdf) ? pdf : null;
}

export function bundledRuntimeSummary(): {
  edition: "full" | "standard";
  python: boolean;
  jre: boolean;
  jmeter: boolean;
  root: string | null;
  manifest: BundledRuntimeManifest | null;
} {
  const root = bundledRuntimeRoot();
  const python = Boolean(getBundledPythonExe());
  const jre = Boolean(getBundledJreHome());
  const jmeter = Boolean(getBundledJmeterHome());
  const manifest = readBundledRuntimeManifest();
  const integrated = python && jre && jmeter;
  const edition: "full" | "standard" =
    manifest?.edition === "full" || integrated ? "full" : "standard";
  return {
    edition,
    python,
    jre,
    jmeter,
    root,
    manifest,
  };
}