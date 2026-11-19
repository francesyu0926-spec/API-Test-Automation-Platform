import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cachedRoot: string | null = null;

function hasAtpCliRoot(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, "atp", "cli.py"));
  } catch {
    return false;
  }
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (!p?.trim()) continue;
    const resolved = path.resolve(p);
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

function bundledPlatformRoot(): string | null {
  try {
    if (!app.isPackaged) return null;
    const root = path.join(process.resourcesPath, "platform");
    if (hasAtpCliRoot(root)) return root;
  } catch {
    /* ignore */
  }
  return null;
}

/** Resolve platform repo root (contains atp/cli.py and projects/). */
export function discoverRepoRootCandidates(mainDir?: string): string[] {
  const candidates: string[] = [];

  const bundled = bundledPlatformRoot();
  if (bundled) candidates.push(bundled);

  const fromEnv = process.env.ATP_REPO_ROOT;
  if (fromEnv?.trim()) candidates.push(fromEnv);

  const cwd = process.cwd();
  candidates.push(cwd);
  candidates.push(path.resolve(cwd, ".."));
  candidates.push(path.resolve(cwd, "..", ".."));

  const bundleDir = mainDir?.trim() ? path.resolve(mainDir) : null;
  if (bundleDir) {
    candidates.push(bundleDir);
    candidates.push(path.resolve(bundleDir, ".."));
    candidates.push(path.resolve(bundleDir, "../.."));
    candidates.push(path.resolve(bundleDir, "../../.."));
    candidates.push(path.resolve(bundleDir, "../../../.."));
  }

  try {
    if (app.isReady()) {
      const appPath = app.getAppPath();
      candidates.push(appPath);
      candidates.push(path.resolve(appPath, ".."));
      candidates.push(path.resolve(appPath, "..", ".."));
      candidates.push(path.resolve(appPath, "..", "..", ".."));
    }
  } catch {
    /* app not ready */
  }

  return uniquePaths(candidates);
}

export function resolveRepoRoot(mainDir?: string): string {
  for (const c of discoverRepoRootCandidates(mainDir)) {
    if (hasAtpCliRoot(c)) return c;
  }
  const cwd = process.cwd();
  if (hasAtpCliRoot(cwd)) return path.resolve(cwd);
  return path.resolve(cwd, "..");
}

/** Call once from main process so `cwd` does not pick the wrong parent on startup. */
export function initRepoRoot(mainFilename?: string): string {
  let mainDir: string | undefined;
  if (mainFilename) {
    mainDir = path.dirname(mainFilename);
  } else if (typeof __dirname !== "undefined") {
    mainDir = __dirname;
  }
  cachedRoot = resolveRepoRoot(mainDir);
  return cachedRoot;
}

export function getRepoRoot(): string {
  if (cachedRoot) return cachedRoot;
  cachedRoot = resolveRepoRoot(typeof __dirname !== "undefined" ? __dirname : undefined);
  return cachedRoot;
}

export function setRepoRoot(root: string): void {
  cachedRoot = path.resolve(root);
}

export function pythonExecutable(repoRoot: string): string {
  const win = path.join(repoRoot, ".venv", "Scripts", "python.exe");
  const unix = path.join(repoRoot, ".venv", "bin", "python");
  if (process.platform === "win32" && fs.existsSync(win)) return win;
  if (fs.existsSync(unix)) return unix;
  return process.platform === "win32" ? "python" : "python3";
}

/** ESM entry helper when __dirname is unavailable. */
export function initRepoRootFromImportMeta(url: string): string {
  const mainFilename = fileURLToPath(url);
  return initRepoRoot(mainFilename);
}