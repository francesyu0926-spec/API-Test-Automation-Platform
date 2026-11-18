import { DEFAULT_JTL_STREAM_MODE, type JtlStreamModeId } from "../../shared/jtlStreamModes";

const STORAGE_KEY_CURRENT = "atp.jtlStreamMode";
const STORAGE_KEY_DEFAULT = "atp.jtlStreamModeDefault";
const LEGACY_KEY = STORAGE_KEY_CURRENT;

function readMode(raw: string | null): JtlStreamModeId | null {
  if (raw === "fast" || raw === "standard" || raw === "deep") return raw;
  return null;
}

/** 设置中的全局默认（新开页、未单独改过时使用） */
export function loadJtlStreamDefaultMode(): JtlStreamModeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DEFAULT);
    const hit = readMode(raw);
    if (hit) return hit;
    const legacy = readMode(localStorage.getItem(LEGACY_KEY));
    if (legacy) return legacy;
  } catch {
    /* ignore */
  }
  return DEFAULT_JTL_STREAM_MODE;
}

export function persistJtlStreamDefaultMode(mode: JtlStreamModeId): void {
  try {
    localStorage.setItem(STORAGE_KEY_DEFAULT, mode);
  } catch {
    /* ignore */
  }
}

/** 负载测试顶栏当前选中的解析模式 */
export function loadPersistedJtlStreamMode(): JtlStreamModeId {
  try {
    const hit = readMode(localStorage.getItem(STORAGE_KEY_CURRENT));
    if (hit) return hit;
  } catch {
    /* ignore */
  }
  return loadJtlStreamDefaultMode();
}

export function persistJtlStreamMode(mode: JtlStreamModeId): void {
  try {
    localStorage.setItem(STORAGE_KEY_CURRENT, mode);
  } catch {
    /* ignore */
  }
}

/** 保存默认后同步当前工作区选择（可选） */
export function applyJtlStreamDefaultToCurrent(): void {
  persistJtlStreamMode(loadJtlStreamDefaultMode());
}