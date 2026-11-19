import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { platform } from "node:os";

import { resolveMitmBinary } from "./captureService";
import { getMitmCaCerPath, isMitmCaTrusted } from "./mitmCert";
import { getRepoRoot, pythonExecutable } from "./repo";
import { runPython } from "./pythonRun";

const execFileAsync = promisify(execFile);

import type { CaptureStartupCheck } from "../shared/captureStartupTypes";

export type { CaptureStartupCheck } from "../shared/captureStartupTypes";

const DEFAULT_MITM_PORT = 8888;
const PORT_SCAN_MAX = 12;

export function tryBindPort(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function pythonExists(): Promise<boolean> {
  const py = pythonExecutable(getRepoRoot());
  try {
    const r = await runPython(["-c", "import sys; print(sys.version)"]);
    return r.code === 0;
  } catch {
    return false;
  }
}

async function mitmproxyImportOk(): Promise<boolean> {
  try {
    const r = await runPython(["-c", "import mitmproxy"]);
    return r.code === 0;
  } catch {
    return false;
  }
}

async function processNameForPid(pid: number): Promise<string> {
  if (platform() !== "win32" || !pid) return `pid:${pid}`;
  try {
    const { stdout } = await execFileAsync(
      "tasklist",
      ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
      { encoding: "utf8", windowsHide: true, timeout: 8000 },
    );
    const line = stdout.trim().split(/\r?\n/)[0] ?? "";
    const m = line.match(/^"([^"]+)"/);
    return m?.[1] ?? line.split(",")[0]?.replace(/"/g, "") ?? `pid:${pid}`;
  } catch {
    return `pid:${pid}`;
  }
}

export async function findPortOccupier(port: number): Promise<{ pid: number; name: string } | null> {
  if (platform() !== "win32") return null;
  try {
    const { stdout } = await execFileAsync("netstat", ["-ano"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    });
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) continue;
      if (!new RegExp(`:${port}\\b`).test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = Number.parseInt(parts[parts.length - 1] ?? "", 10);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      const name = await processNameForPid(pid);
      return { pid, name };
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function killPid(pid: number): Promise<void> {
  if (platform() !== "win32") return;
  try {
    await execFileAsync("taskkill", ["/PID", String(pid), "/F"], { windowsHide: true, timeout: 8000 });
  } catch {
    /* ignore */
  }
}

function isMitmProcessName(name: string): boolean {
  return /mitmdump|mitmproxy/i.test(name);
}

async function findNextFreePort(fromPort: number): Promise<number | null> {
  for (let p = fromPort; p < fromPort + PORT_SCAN_MAX; p++) {
    if (await tryBindPort(p)) return p;
  }
  return null;
}

async function stage1Dependency(): Promise<CaptureStartupCheck | null> {
  const listenPort = DEFAULT_MITM_PORT;
  const hasPy = await pythonExists();
  if (!hasPy) {
    return {
      ok: false,
      code: "ERR_NO_PYTHON",
      stage: 1,
      message: "未检测到可用的 Python 环境。请先创建 .venv 或在本机安装 Python 3。",
      listenPort,
      actions: [
        { id: "open_repo", label: "打开数据目录" },
        { id: "install_deps", label: "立即安装组件" },
      ],
    };
  }
  const binary = await resolveMitmBinary();
  const importOk = await mitmproxyImportOk();
  if (!binary && !importOk) {
    return {
      ok: false,
      code: "ERR_NO_MITM",
      stage: 1,
      message: "未检测到抓包引擎 (mitmproxy)。",
      listenPort,
      actions: [
        { id: "install_deps", label: "立即安装组件" },
        { id: "open_repo", label: "配置环境" },
      ],
    };
  }
  return null;
}

async function stage2Port(
  preferredPort: number,
  opts: { autoKillZombieMitm: boolean; autoSwitchPort: boolean },
): Promise<{ check: CaptureStartupCheck | null; listenPort: number }> {
  let port = preferredPort;
  if (await tryBindPort(port)) {
    return { check: null, listenPort: port };
  }

  const occupier = await findPortOccupier(port);
  if (occupier && opts.autoKillZombieMitm && isMitmProcessName(occupier.name)) {
    await killPid(occupier.pid);
    await new Promise((r) => setTimeout(r, 400));
    if (await tryBindPort(port)) {
      return { check: null, listenPort: port };
    }
  }

  const suggested = await findNextFreePort(port + 1);
  const occupierName = occupier?.name ?? "未知进程";

  if (opts.autoSwitchPort && suggested) {
    return { check: null, listenPort: suggested };
  }

  return {
    check: {
      ok: false,
      code: "WARN_PORT_USED",
      stage: 2,
      message: `端口 ${port} 被【${occupierName}】占用，建议切换至可用端口 ${suggested ?? port + 1}。`,
      listenPort: port,
      suggestedPort: suggested ?? port + 1,
      occupierProcess: occupierName,
      actions: [{ id: "use_new_port", label: "使用新端口启动" }],
    },
    listenPort: port,
  };
}

async function stage3Certificate(): Promise<CaptureStartupCheck | null> {
  const listenPort = DEFAULT_MITM_PORT;
  try {
    await getMitmCaCerPath();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/正在|生成|初始化/i.test(msg)) {
      return {
        ok: false,
        code: "ERR_CERT_MISSING",
        stage: 3,
        message: "正在首次初始化安全证书，请稍候…",
        listenPort,
        actions: [],
      };
    }
    return {
      ok: false,
      code: "ERR_CERT_MISSING",
      stage: 3,
      message: msg || "安全证书未就绪，请稍后重试。",
      listenPort,
      actions: [{ id: "install_deps", label: "重试安装组件" }],
    };
  }

  const trusted = await isMitmCaTrusted();
  if (!trusted) {
    return {
      ok: false,
      code: "ERR_CERT_UNTRUSTED",
      stage: 3,
      message:
        "系统尚未信任抓包根证书，HTTPS 请求无法解密。请点击下方一键信任证书（仅当前用户，无需管理员）。",
      listenPort,
      actions: [
        { id: "install_cert", label: "一键信任证书" },
        { id: "export_cert", label: "导出证书手动安装" },
      ],
    };
  }
  return null;
}

export async function runCaptureStartupPipeline(options?: {
  preferredPort?: number;
  autoKillZombieMitm?: boolean;
  autoSwitchPort?: boolean;
  skipCertCheck?: boolean;
}): Promise<CaptureStartupCheck> {
  const preferredPort = options?.preferredPort ?? DEFAULT_MITM_PORT;

  const s1 = await stage1Dependency();
  if (s1) return s1;

  const s2 = await stage2Port(preferredPort, {
    autoKillZombieMitm: options?.autoKillZombieMitm ?? true,
    autoSwitchPort: options?.autoSwitchPort ?? false,
  });
  if (s2.check) return s2.check;

  if (!options?.skipCertCheck) {
    const s3 = await stage3Certificate();
    if (s3) return s3;
  }

  return {
    ok: true,
    code: "OK_READY",
    stage: 4,
    message: `自检通过，准备监听 127.0.0.1:${s2.listenPort}。`,
    listenPort: s2.listenPort,
    actions: [],
  };
}

export async function installCaptureDependencies(): Promise<{ ok: boolean; message: string }> {
  const root = getRepoRoot();
  const req = path.join(root, "requirements-capture.txt");
  try {
    await fs.access(req);
  } catch {
    return { ok: false, message: `缺少 ${req}` };
  }
  const py = pythonExecutable(root);
  return new Promise((resolve) => {
    const child = spawn(py, ["-m", "pip", "install", "-r", "requirements-capture.txt"], {
      cwd: root,
      env: { ...process.env, PYTHONUTF8: "1" },
      windowsHide: true,
    });
    let err = "";
    child.stderr?.on("data", (d) => {
      err += d.toString();
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, message: "抓包组件安装完成，请再次点击「开始抓包」。" });
      } else {
        resolve({
          ok: false,
          message: err.trim().slice(-800) || `pip 退出码 ${code ?? "?"}`,
        });
      }
    });
    child.on("error", (e) => {
      resolve({ ok: false, message: e.message });
    });
  });
}