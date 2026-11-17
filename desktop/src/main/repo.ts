import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

let cachedRoot: string | null = null;

export function getRepoRoot(): string {
  if (cachedRoot) return cachedRoot;
  const fromEnv = process.env.ATP_REPO_ROOT;
  if (fromEnv && fs.existsSync(fromEnv)) {
    cachedRoot = path.resolve(fromEnv);
    return cachedRoot;
  }
  const candidates = [
    path.resolve(process.cwd(), ".."),
    path.resolve(app.getAppPath(), "..", ".."),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "atp", "cli.py"))) {
      cachedRoot = c;
      return cachedRoot;
    }
  }
  return path.resolve(process.cwd(), "..");
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