import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { platform } from "node:os";
import { promisify } from "node:util";

import { getRepoRoot } from "./repo";
import { refreshWininetFromPs } from "./windowsProxy";

const execFileAsync = promisify(execFile);

const IE_REG =
  "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

export type CaptureProxyBackup = {
  is_capturing: boolean;
  proxyEnable: number;
  proxyServer: string;
  proxyOverride: string;
  autoConfigUrl: string;
  winHttp: {
    raw: string;
    directAccess: boolean;
    proxyServer?: string;
  };
  savedAt: string;
  /** Main process PID that spawned the proxy watchdog for this snapshot */
  watchdogMainPid?: number;
};

export function captureProxyBackupPath(): string {
  const fromEnv = process.env.ATP_CAPTURE_PROXY_BACKUP?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(getRepoRoot(), "data", "capture_proxy_backup.json");
}

function runPowerShell(command: string): string {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8", windowsHide: true, timeout: 15000 },
  ).trim();
}

async function showWinHttpProxy(): Promise<string> {
  if (platform() !== "win32") return "";
  try {
    const { stdout } = await execFileAsync("netsh", ["winhttp", "show", "proxy"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

function parseWinHttpSnapshot(raw: string): CaptureProxyBackup["winHttp"] {
  const t = raw.toLowerCase();
  const directAccess = !raw.trim() || t.includes("direct access") || !t.includes("proxy server");
  let proxyServer: string | undefined;
  const m = raw.match(/proxy\s+server\s*\(\s*s\s*\)\s*:\s*(.+)/i);
  if (m?.[1]) {
    const line = m[1].trim().split(/\r?\n/)[0]?.trim();
    if (line && !/^direct/i.test(line)) proxyServer = line;
  }
  return { raw, directAccess: directAccess && !proxyServer, proxyServer };
}

function readInternetSettingsRegistry(): Pick<
  CaptureProxyBackup,
  "proxyEnable" | "proxyServer" | "proxyOverride" | "autoConfigUrl"
> {
  if (platform() !== "win32") {
    return { proxyEnable: 0, proxyServer: "", proxyOverride: "", autoConfigUrl: "" };
  }
  try {
    const enable = runPowerShell(`(Get-ItemProperty '${IE_REG}').ProxyEnable`);
    const server = runPowerShell(
      `@((Get-ItemProperty '${IE_REG}' -ErrorAction SilentlyContinue).ProxyServer)`,
    );
    const override = runPowerShell(
      `@((Get-ItemProperty '${IE_REG}' -ErrorAction SilentlyContinue).ProxyOverride)`,
    );
    const pac = runPowerShell(
      `@((Get-ItemProperty '${IE_REG}' -ErrorAction SilentlyContinue).AutoConfigURL)`,
    );
    return {
      proxyEnable: String(enable) === "1" ? 1 : 0,
      proxyServer: server && server !== "" ? String(server) : "",
      proxyOverride: override && override !== "" ? String(override) : "",
      autoConfigUrl: pac && pac !== "" ? String(pac) : "",
    };
  } catch {
    return { proxyEnable: 0, proxyServer: "", proxyOverride: "", autoConfigUrl: "" };
  }
}

export async function writeCaptureProxyBackup(): Promise<void> {
  if (platform() !== "win32") return;
  const ie = readInternetSettingsRegistry();
  const winHttpRaw = await showWinHttpProxy();
  const doc: CaptureProxyBackup = {
    is_capturing: true,
    ...ie,
    winHttp: parseWinHttpSnapshot(winHttpRaw),
    savedAt: new Date().toISOString(),
  };
  const filePath = captureProxyBackupPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(doc, null, 2), "utf8");
}

export async function readCaptureProxyBackup(): Promise<CaptureProxyBackup | null> {
  try {
    const text = await fs.readFile(captureProxyBackupPath(), "utf8");
    const doc = JSON.parse(text) as CaptureProxyBackup;
    if (typeof doc.is_capturing !== "boolean") return null;
    return doc;
  } catch {
    return null;
  }
}

export async function hasActiveCaptureProxyBackup(): Promise<boolean> {
  const doc = await readCaptureProxyBackup();
  return Boolean(doc?.is_capturing);
}

export async function stampCaptureProxyWatchdogMainPid(mainPid: number): Promise<void> {
  const doc = await readCaptureProxyBackup();
  if (!doc?.is_capturing) return;
  doc.watchdogMainPid = mainPid;
  await fs.writeFile(captureProxyBackupPath(), JSON.stringify(doc, null, 2), "utf8");
}

async function applyInternetSettingsRegistry(
  snap: Pick<CaptureProxyBackup, "proxyEnable" | "proxyServer" | "proxyOverride" | "autoConfigUrl">,
): Promise<void> {
  const esc = (s: string) => s.replace(/'/g, "''");
  const parts = [
    `$p='${IE_REG}';`,
    `Set-ItemProperty -Path $p -Name ProxyEnable -Value ${snap.proxyEnable};`,
  ];
  if (snap.proxyServer) {
    parts.push(`Set-ItemProperty -Path $p -Name ProxyServer -Value '${esc(snap.proxyServer)}';`);
  } else {
    parts.push(`Remove-ItemProperty -Path $p -Name ProxyServer -ErrorAction SilentlyContinue;`);
  }
  if (snap.proxyOverride) {
    parts.push(`Set-ItemProperty -Path $p -Name ProxyOverride -Value '${esc(snap.proxyOverride)}';`);
  } else {
    parts.push(`Remove-ItemProperty -Path $p -Name ProxyOverride -ErrorAction SilentlyContinue;`);
  }
  if (snap.autoConfigUrl) {
    parts.push(`Set-ItemProperty -Path $p -Name AutoConfigURL -Value '${esc(snap.autoConfigUrl)}';`);
  } else {
    parts.push(`Remove-ItemProperty -Path $p -Name AutoConfigURL -ErrorAction SilentlyContinue;`);
  }
  runPowerShell(parts.join(" "));
  refreshWininetFromPs();
}

async function restoreWinHttpFromSnapshot(winHttp: CaptureProxyBackup["winHttp"]): Promise<void> {
  if (platform() !== "win32") return;
  try {
    if (winHttp.directAccess || !winHttp.proxyServer?.trim()) {
      await execFileAsync("netsh", ["winhttp", "reset", "proxy"], {
        encoding: "utf8",
        windowsHide: true,
      });
      return;
    }
    const proxy = winHttp.proxyServer.trim();
    await execFileAsync("netsh", ["winhttp", "set", "proxy", proxy], {
      encoding: "utf8",
      windowsHide: true,
    });
  } catch {
    try {
      await execFileAsync("netsh", ["winhttp", "import", "proxy", "source=ie"], {
        encoding: "utf8",
        windowsHide: true,
      });
    } catch {
      /* best effort */
    }
  }
}

async function deleteCaptureProxyBackupFile(): Promise<void> {
  try {
    await fs.unlink(captureProxyBackupPath());
  } catch {
    /* ignore */
  }
}

/** 从 JSON 快照恢复注册表 / WinHTTP，成功后删除快照 */
export async function restoreCaptureProxyFromBackup(): Promise<{ ok: boolean; message: string }> {
  if (platform() !== "win32") return { ok: true, message: "" };
  const snap = await readCaptureProxyBackup();
  if (!snap) {
    return { ok: false, message: "无抓包代理备份文件" };
  }
  if (!snap.is_capturing) {
    return { ok: false, message: "备份未标记为抓包中" };
  }
  try {
    await applyInternetSettingsRegistry(snap);
    await restoreWinHttpFromSnapshot(snap.winHttp);
    await deleteCaptureProxyBackupFile();
    const detail =
      snap.proxyEnable || snap.autoConfigUrl
        ? snap.autoConfigUrl
          ? `已恢复 PAC/代理（${snap.autoConfigUrl.slice(0, 60)}）`
          : snap.proxyServer
            ? `已恢复代理 ${snap.proxyServer}`
            : "已恢复代理设置"
        : "已关闭系统代理";
    return { ok: true, message: detail };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}