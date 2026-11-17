import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { platform } from "node:os";

import { getRepoRoot } from "./repo";
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
    list.push("httpbin.org");
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