import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { platform } from "node:os";

function runPowerShell(command: string): string {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8", windowsHide: true, timeout: 12000 },
  ).trim();
}

export function resolveChromeExe(): string | null {
  if (platform() !== "win32") return null;
  const candidates = [
    () =>
      runPowerShell(
        "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe' -ErrorAction SilentlyContinue).'(default)'",
      ),
    () =>
      runPowerShell(
        "(Get-ItemProperty 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe' -ErrorAction SilentlyContinue).'(default)'",
      ),
    () => path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
    () => path.join(process.env["ProgramFiles"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
    () =>
      path.join(process.env["ProgramFiles(x86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  ];
  for (const get of candidates) {
    try {
      const p = get();
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* next */
    }
  }
  return null;
}

/** 等价于在已运行的 Chrome 地址栏输入 chrome://restart（一般保留标签页） */
export function restartChromeForTrustStore(): { ok: boolean; message: string } {
  const chrome = resolveChromeExe();
  if (!chrome) {
    return {
      ok: false,
      message: "未找到 Chrome。若用 Edge，请手动打开 edge://restart；或新开无痕窗口试 HTTPS。",
    };
  }
  try {
    const child = spawn(chrome, ["chrome://restart"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return { ok: true, message: "已自动触发 Chrome 软重启（标签页通常会保留）。" };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}