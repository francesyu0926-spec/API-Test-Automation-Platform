import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";

import { captureProxyBackupPath, stampCaptureProxyWatchdogMainPid } from "./captureProxyBackup";
import { getRepoRoot } from "./repo";

let guardChild: ChildProcess | null = null;
let guardPid: number | undefined;

export function captureProxyGuardStopPath(): string {
  return path.join(getRepoRoot(), "data", "capture_proxy_guard.stop");
}

function proxyGuardScriptPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "proxy-guard.js");
}

/** Spawn detached watchdog (survives main process exit). No-op off Windows or without backup workflow. */
export async function startCaptureProxyWatchdog(mitmPid: number): Promise<void> {
  if (platform() !== "win32") return;
  await stopCaptureProxyWatchdog();

  const script = proxyGuardScriptPath();
  const backupPath = captureProxyBackupPath();
  const stopPath = captureProxyGuardStopPath();
  const repoRoot = getRepoRoot();

  const args = [
    script,
    "--main-pid",
    String(process.pid),
    "--mitm-pid",
    String(mitmPid || 0),
    "--backup-path",
    backupPath,
    "--repo-root",
    repoRoot,
    "--stop-path",
    stopPath,
  ];

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ATP_REPO_ROOT: repoRoot,
    },
  });
  child.unref();
  guardChild = child;
  guardPid = child.pid;
  await stampCaptureProxyWatchdogMainPid(process.pid);
}

/** Signal graceful stop so guard does not restore after intentional MITM shutdown. */
export async function stopCaptureProxyWatchdog(): Promise<void> {
  if (platform() !== "win32") return;

  const stopPath = captureProxyGuardStopPath();
  try {
    await fs.mkdir(path.dirname(stopPath), { recursive: true });
    await fs.writeFile(stopPath, `${Date.now()}\n`, "utf8");
  } catch {
    /* ignore */
  }

  const pid = guardChild?.pid ?? guardPid;
  if (pid) {
    try {
      process.kill(pid);
    } catch {
      /* already exited */
    }
  }
  guardChild = null;
  guardPid = undefined;

  try {
    await fs.unlink(stopPath);
  } catch {
    /* ignore */
  }
}