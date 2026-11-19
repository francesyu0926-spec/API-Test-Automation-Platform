import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

function fallbackDocumentsDir(): string {
  return app.getPath("documents");
}

function dirExists(dir: string): boolean {
  try {
    return existsSync(dir) && statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 保证另存为默认路径的父目录存在。仅文件名时锚定到「文档」，避免 Windows 记住已删除目录导致「位置不可用」。
 */
export function resolveSaveDialogDefaultPath(defaultPath?: string, fallbackBaseName = "export"): string {
  const fallbackDir = fallbackDocumentsDir();
  const raw = defaultPath?.trim();
  if (!raw) {
    return path.join(fallbackDir, fallbackBaseName);
  }

  const hasDirSep = /[\\/]/.test(raw);
  if (!hasDirSep) {
    return path.join(fallbackDir, path.basename(raw));
  }

  const normalized = path.isAbsolute(raw) ? path.normalize(raw) : path.normalize(path.join(fallbackDir, raw));
  const parent = path.dirname(normalized);
  const base = path.basename(normalized);
  if (dirExists(parent)) {
    return normalized;
  }
  return path.join(fallbackDir, base);
}

/** 打开/选择文件时对 defaultPath 做同样校验（文件不存在时退回其所在目录或文档目录） */
export function resolveOpenDialogDefaultPath(defaultPath?: string): string | undefined {
  const raw = defaultPath?.trim();
  if (!raw) return undefined;

  const normalized = path.isAbsolute(raw) ? path.normalize(raw) : path.normalize(path.join(fallbackDocumentsDir(), raw));

  try {
    if (existsSync(normalized)) {
      const st = statSync(normalized);
      if (st.isDirectory()) return normalized;
      return normalized;
    }
  } catch {
    /* ignore */
  }

  const parent = path.dirname(normalized);
  if (dirExists(parent)) {
    return normalized;
  }
  return fallbackDocumentsDir();
}