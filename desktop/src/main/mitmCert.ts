import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { restartChromeForTrustStore } from "./chromeRestart";
import { resolveMitmBinary } from "./captureService";
import { getRepoRoot } from "./repo";

const execFileAsync = promisify(execFile);

async function mitmCaPaths(): Promise<{ cer: string; pem: string; dir: string }> {
  const dir = path.join(os.homedir(), ".mitmproxy");
  return {
    dir,
    cer: path.join(dir, "mitmproxy-ca-cert.cer"),
    pem: path.join(dir, "mitmproxy-ca-cert.pem"),
  };
}

export async function isMitmCaTrusted(): Promise<boolean> {
  if (process.platform !== "win32") return true;
  try {
    const { stdout } = await execFileAsync("certutil", ["-store", "-user", "Root"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 45000,
    });
    return /mitmproxy/i.test(stdout);
  } catch {
    return false;
  }
}

export async function getMitmCaCerPath(): Promise<string> {
  return ensureCaGenerated();
}

async function ensureCaGenerated(): Promise<string> {
  const { cer, pem, dir } = await mitmCaPaths();
  try {
    await fs.access(cer);
    return cer;
  } catch {
    /* missing */
  }
  try {
    await fs.access(pem);
    await fs.copyFile(pem, cer);
    return cer;
  } catch {
    /* missing */
  }

  const binary = await resolveMitmBinary();
  if (!binary) {
    throw new Error("未找到 mitmdump。请先 pip install -r requirements-capture.txt");
  }

  const child = spawn(binary, ["--listen-port", "18082", "--listen-host", "127.0.0.1"], {
    stdio: "ignore",
    windowsHide: true,
    detached: false,
  });

  await new Promise((r) => setTimeout(r, 3500));
  child.kill();

  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  try {
    await fs.access(cer);
    return cer;
  } catch {
    try {
      await fs.access(pem);
      await fs.copyFile(pem, cer);
      return cer;
    } catch {
      throw new Error("mitmproxy 未生成证书，请先启动一次「MITM 代理」后重试");
    }
  }
}

export async function installMitmCaToUserRoot(): Promise<{ ok: boolean; message: string; certPath?: string }> {
  try {
    const certPath = await ensureCaGenerated();
    if (process.platform === "win32") {
      const ps1 = path.join(getRepoRoot(), "scripts", "install_mitm_ca.ps1");
      await execFileAsync(
        "powershell.exe",
        ["-ExecutionPolicy", "Bypass", "-NoProfile", "-File", ps1],
        { timeout: 60000, windowsHide: true },
      );
      const restart = restartChromeForTrustStore();
      const extra = restart.ok
        ? restart.message
        : `${restart.message} 可在地址栏手动打开 chrome://restart。`;
      return {
        ok: true,
        certPath,
        message: `证书已装入「当前用户 → 受信任的根证书颁发机构」。${extra}`,
      };
    }
    return {
      ok: false,
      message: "自动安装当前仅支持 Windows。请打开 http://mitm.it 手动安装。",
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function openMitmItCertPage(): Promise<void> {
  const { shell } = await import("electron");
  await shell.openExternal("http://mitm.it");
}