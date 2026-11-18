import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { platform } from "node:os";

import { getRepoRoot } from "./repo";
import { parseCaptureHostList } from "./captureHosts";
import { refreshWininetFromPs } from "./windowsProxy";

const PAC_REG_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

let savedPacEnabled = false;

function runPowerShell(command: string): string {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8", windowsHide: true, timeout: 15000 },
  ).trim();
}

/** Hosts: comma-separated, e.g. httpbin.org,api.example.com */
export async function writePacFile(hosts: string[], mitmPort: number): Promise<string> {
  const list = hosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!list.length) {
    throw new Error("PAC 域名列表为空，请填写要快照的 API 主机名");
  }
  const hostJs = list.map((h) => `"${h.replace(/"/g, "")}"`).join(", ");
  const pac = `function FindProxyForURL(url, host) {
  host = host.toLowerCase();
  var apis = [${hostJs}];
  for (var i = 0; i < apis.length; i++) {
    var p = apis[i];
    if (host === p || dnsDomainIs(host, p) || shExpMatch(host, "*." + p)) {
      return "PROXY 127.0.0.1:${mitmPort}";
    }
  }
  return "DIRECT";
}
`;
  const pacPath = path.join(getRepoRoot(), "scripts", "atp-proxy.pac");
  await fs.writeFile(pacPath, pac, "utf8");
  return pacPath;
}

/**
 * 内嵌 WebView：除内网/本机与用户配置的直连域外，其余 HTTP(S) 走 mitm（便于抓到 iframe/H5 外链）。
 */
export async function writeEmbeddedWebPacFile(bypassHostsInput: string, mitmPort: number): Promise<string> {
  const bypass = parseCaptureHostList(bypassHostsInput);
  const bypassJs = bypass.map((h) => `"${h.replace(/"/g, "")}"`).join(", ");
  const pac = `function FindProxyForURL(url, host) {
  host = (host || "").toLowerCase();
  if (!host) return "DIRECT";
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "DIRECT";
  if (shExpMatch(host, "10.*") || shExpMatch(host, "192.168.*") || shExpMatch(host, "169.254.*")) return "DIRECT";
  if (shExpMatch(host, "172.1*") || shExpMatch(host, "172.2*") || shExpMatch(host, "172.3*")) return "DIRECT";
  var bypass = [${bypassJs}];
  for (var i = 0; i < bypass.length; i++) {
    var p = bypass[i];
    if (host === p || dnsDomainIs(host, p) || shExpMatch(host, "*." + p)) return "DIRECT";
  }
  var proto = (url || "").substring(0, 6).toLowerCase();
  if (proto === "http:" || proto === "https") {
    return "PROXY 127.0.0.1:${mitmPort}";
  }
  return "DIRECT";
}
`;
  const pacPath = path.join(getRepoRoot(), "scripts", "atp-proxy-embedded.pac");
  await fs.writeFile(pacPath, pac, "utf8");
  return pacPath;
}

export function enablePacProxy(pacUrl: string): { ok: boolean; message: string } {
  if (platform() !== "win32") {
    return { ok: false, message: "PAC 仅支持 Windows" };
  }
  try {
    const before = runPowerShell(
      "(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings').ProxyEnable",
    );
    savedPacEnabled = before === "1";
    const url = pacUrl.replace(/'/g, "''");
    runPowerShell(
      `$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; ` +
        `Remove-ItemProperty -Path $p -Name ProxyServer -ErrorAction SilentlyContinue; ` +
        `Set-ItemProperty -Path $p -Name ProxyEnable -Value 1; ` +
        `Set-ItemProperty -Path $p -Name AutoConfigURL -Value '${url}'; ` +
        `Set-ItemProperty -Path $p -Name ProxyOverride -Value '<local>'`,
    );
    refreshWininetFromPs();
    return {
      ok: true,
      message: `已启用 PAC：仅填写的 API 域名走 127.0.0.1:8888，其它站点直连。`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function disablePacProxy(): void {
  if (platform() !== "win32") return;
  try {
    runPowerShell(
      `$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; ` +
        `Remove-ItemProperty -Path $p -Name AutoConfigURL -ErrorAction SilentlyContinue; ` +
        `Set-ItemProperty -Path $p -Name ProxyEnable -Value ${savedPacEnabled ? 1 : 0}`,
    );
    refreshWininetFromPs();
  } catch {
    /* ignore */
  }
}