import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import net from "node:net";
import { platform } from "node:os";

const REG_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

export type ProxyState = {
  enabled: boolean;
  server: string;
  autoConfigUrl: string;
};

const ATP_PAC_MARKERS = ["atp-proxy.pac", "/proxy.pac", "8766"];

export function isLikelyAtpCaptureProxy(state: ProxyState, mitmPort = 8888): boolean {
  const pac = state.autoConfigUrl.toLowerCase();
  if (ATP_PAC_MARKERS.some((m) => pac.includes(m))) return true;
  const srv = state.server.toLowerCase();
  if (!state.enabled) return false;
  return srv.includes(`127.0.0.1:${mitmPort}`) || srv.includes(`:${mitmPort}`);
}

let savedBeforeMitm: ProxyState | null = null;
let winHttpTouched = false;

async function showWinHttpProxy(): Promise<string> {
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

/** 许多桌面终端 / .NET 客户端走 WinHTTP，与 IE 系统代理分离 */
export async function setWinHttpProxy(host: string, port: number): Promise<{ ok: boolean; message: string }> {
  if (platform() !== "win32") return { ok: false, message: "" };
  try {
    await execFileAsync("netsh", ["winhttp", "set", "proxy", `${host}:${port}`], {
      encoding: "utf8",
      windowsHide: true,
    });
    winHttpTouched = true;
    return { ok: true, message: `WinHTTP → ${host}:${port}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function resetWinHttpProxy(): Promise<void> {
  if (platform() !== "win32" || !winHttpTouched) return;
  try {
    await execFileAsync("netsh", ["winhttp", "reset", "proxy"], { encoding: "utf8", windowsHide: true });
  } catch {
    /* ignore */
  }
  winHttpTouched = false;
}

export async function getWinHttpProxyStatus(): Promise<string> {
  return showWinHttpProxy();
}

function runPowerShell(command: string): string {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8", windowsHide: true, timeout: 15000 },
  ).trim();
}

export function readProxyState(): ProxyState {
  if (platform() !== "win32") {
    return { enabled: false, server: "", autoConfigUrl: "" };
  }
  try {
    const enabled = runPowerShell(
      "(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings').ProxyEnable",
    );
    const server = runPowerShell(
      "@((Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction SilentlyContinue).ProxyServer)",
    );
    const pac = runPowerShell(
      "@((Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction SilentlyContinue).AutoConfigURL)",
    );
    return {
      enabled: String(enabled) === "1",
      server: server && server !== "" ? String(server) : "",
      autoConfigUrl: pac && pac !== "" ? String(pac) : "",
    };
  } catch {
    return { enabled: false, server: "", autoConfigUrl: "" };
  }
}

export function refreshWininetFromPs(): void {
  try {
    runPowerShell(
      `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class W { [DllImport("wininet.dll")] public static extern bool InternetSetOption(IntPtr a,int b,IntPtr c,int d); }
'@; [W]::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0)|Out-Null; [W]::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0)|Out-Null`,
    );
  } catch {
    /* best effort */
  }
}

function refreshWininet(): void {
  refreshWininetFromPs();
}

export async function setWindowsSystemProxy(host: string, port: number): Promise<{ ok: boolean; message: string }> {
  if (platform() !== "win32") {
    return { ok: false, message: "自动设代理仅支持 Windows" };
  }
  if (!savedBeforeMitm) {
    savedBeforeMitm = readProxyState();
  }
  const proxy = `${host}:${port}`;
  try {
    runPowerShell(
      `$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; ` +
        `Remove-ItemProperty -Path $p -Name AutoConfigURL -ErrorAction SilentlyContinue; ` +
        `Set-ItemProperty -Path $p -Name ProxyEnable -Value 1; ` +
        `Set-ItemProperty -Path $p -Name ProxyServer -Value '${proxy}'; ` +
        `Set-ItemProperty -Path $p -Name ProxyOverride -Value '<local>'`,
    );
    refreshWininet();
    const after = readProxyState();
    if (!after.enabled || !after.server.includes(String(port))) {
      return {
        ok: false,
        message: `代理写入失败。当前：启用=${after.enabled} 服务器=${after.server || "(空)"}`,
      };
    }
    const winHttp = await setWinHttpProxy(host, port);
    const extra = winHttp.ok ? `；${winHttp.message}` : "；WinHTTP 未写入（需管理员时以管理员运行本软件）";
    return {
      ok: true,
      message: `已开启系统代理 ${after.server}${extra}。桌面终端请重启客户端。`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function restoreWindowsSystemProxy(): Promise<{ ok: boolean; message: string }> {
  if (platform() !== "win32") return { ok: true, message: "" };
  await resetWinHttpProxy();
  const prev = savedBeforeMitm ?? readProxyState();
  savedBeforeMitm = null;
  try {
    runPowerShell(
      `$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; ` +
        `Remove-ItemProperty -Path $p -Name AutoConfigURL -ErrorAction SilentlyContinue; ` +
        `Set-ItemProperty -Path $p -Name ProxyEnable -Value ${prev.enabled ? 1 : 0}; ` +
        (prev.server
          ? `Set-ItemProperty -Path $p -Name ProxyServer -Value '${prev.server.replace(/'/g, "''")}'; `
          : "") +
        `Remove-ItemProperty -Path $p -Name ProxyOverride -ErrorAction SilentlyContinue`,
    );
    refreshWininet();
    return { ok: true, message: prev.enabled ? `已恢复代理 ${prev.server}` : "已关闭系统代理" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** 强制关闭代理，便于页面恢复访问 */
export async function forceDisableSystemProxy(): Promise<{ ok: boolean; message: string }> {
  if (platform() !== "win32") return { ok: true, message: "" };
  await resetWinHttpProxy();
  try {
    runPowerShell(
      `$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; ` +
        `Remove-ItemProperty -Path $p -Name AutoConfigURL -ErrorAction SilentlyContinue; ` +
        `Remove-ItemProperty -Path $p -Name ProxyServer -ErrorAction SilentlyContinue; ` +
        `Remove-ItemProperty -Path $p -Name ProxyOverride -ErrorAction SilentlyContinue; ` +
        `Set-ItemProperty -Path $p -Name ProxyEnable -Value 0`,
    );
    refreshWininet();
    savedBeforeMitm = null;
    return { ok: true, message: "已关闭系统代理与 PAC，浏览器应可正常打开网页。" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function getWindowsProxyStatus(): ProxyState {
  return readProxyState();
}

export function isPortListening(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
    socket.connect(port, host);
  });
}