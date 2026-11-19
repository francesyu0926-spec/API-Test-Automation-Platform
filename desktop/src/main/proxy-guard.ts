/**
 * Detached capture proxy watchdog — runs under ELECTRON_RUN_AS_NODE (see captureProxyGuard.ts).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { platform } from "node:os";

type GuardOptions = {
  mainPid: number;
  mitmPid: number;
  backupPath: string;
  repoRoot: string;
  stopPath: string;
};

function parseArgs(argv: string[]): GuardOptions | null {
  let mainPid = 0;
  let mitmPid = 0;
  let backupPath = "";
  let repoRoot = "";
  let stopPath = "";
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case "--main-pid":
        mainPid = Number(next);
        i++;
        break;
      case "--mitm-pid":
        mitmPid = Number(next);
        i++;
        break;
      case "--backup-path":
        backupPath = next ?? "";
        i++;
        break;
      case "--repo-root":
        repoRoot = next ?? "";
        i++;
        break;
      case "--stop-path":
        stopPath = next ?? "";
        i++;
        break;
      default:
        break;
    }
  }
  if (!mainPid || !backupPath || !repoRoot || !stopPath) return null;
  return { mainPid, mitmPid, backupPath, repoRoot, stopPath };
}

function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function run(): Promise<void> {
  if (platform() !== "win32") process.exit(0);

  const opts = parseArgs(process.argv);
  if (!opts) {
    process.exit(2);
  }

  process.env.ATP_REPO_ROOT = opts.repoRoot;
  process.env.ATP_CAPTURE_PROXY_BACKUP = opts.backupPath;

  const { restoreCaptureProxyFromBackup, readCaptureProxyBackup } = await import(
    "./captureProxyBackup.js"
  );

  for (;;) {
    if (await fileExists(opts.stopPath)) {
      process.exit(0);
    }

    const snap = await readCaptureProxyBackup();
    if (!snap?.is_capturing || snap.watchdogMainPid !== opts.mainPid) {
      process.exit(0);
    }

    const mainAlive = isPidAlive(opts.mainPid);
    const mitmWatched = opts.mitmPid > 0;
    const mitmAlive = !mitmWatched || isPidAlive(opts.mitmPid);

    if (!mainAlive || !mitmAlive) {
      const snap = await readCaptureProxyBackup();
      if (
        snap?.is_capturing &&
        snap.watchdogMainPid === opts.mainPid &&
        (await fileExists(opts.backupPath))
      ) {
        await restoreCaptureProxyFromBackup();
      }
      process.exit(0);
    }

    await sleep(1000);
  }
}

void run().catch(() => {
  process.exit(1);
});