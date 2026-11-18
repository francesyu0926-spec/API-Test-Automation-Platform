import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import yaml from "js-yaml";

import { getRepoRoot } from "./repo";
import { runPython, spawnPythonDetached } from "./pythonRun";
import { hostsForPac, parseCaptureHostList } from "./captureHosts";
import { probeHttpsViaMitm } from "./captureProbe";
import { stopPacHttpServer, startPacHttpServer } from "./pacHttp";
import { disablePacProxy, enablePacProxy, writeEmbeddedWebPacFile, writePacFile } from "./pacProxy";
import {
  forceDisableSystemProxy,
  getWindowsProxyStatus,
  getWinHttpProxyStatus,
  isLikelyAtpCaptureProxy,
  isPortListening,
  readProxyState,
  resetWinHttpProxyAlways,
  restoreWindowsSystemProxy,
  setWindowsSystemProxy,
  importWinHttpProxyFromIe,
  winHttpIndicatesCaptureProxy,
  winHttpPointsToMitm,
} from "./windowsProxy";

export type CaptureConfig = {
  ingest_host: string;
  ingest_port: number;
};

export type CaptureSessionRow = {
  id: string;
  project: string;
  label?: string;
  started_at: string;
  finished_at?: string;
  status: string;
  transactionCount: number;
};

export type CaptureTxIndexRow = {
  id: string;
  method: string;
  path: string;
  url: string;
  captured_at: string;
  file: string;
  status?: number;
  duration_ms?: number;
};

type IngestState = {
  project: string;
  sessionId: string;
  host: string;
  port: number;
  process: ChildProcess;
};

function isProcessRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

let ingestState: IngestState | null = null;

type MitmState = {
  listenHost: string;
  listenPort: number;
  process: ChildProcess;
};

let mitmState: MitmState | null = null;

const execFileAsync = promisify(execFile);

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function loadCaptureConfig(): Promise<CaptureConfig> {
  const configPath = path.join(getRepoRoot(), "platform.config.yaml");
  try {
    const text = await fs.readFile(configPath, "utf8");
    const doc = yaml.load(text) as { capture?: CaptureConfig };
    const cap = doc.capture ?? ({} as CaptureConfig);
    return {
      ingest_host: cap.ingest_host ?? "127.0.0.1",
      ingest_port: cap.ingest_port ?? 8765,
    };
  } catch {
    return { ingest_host: "127.0.0.1", ingest_port: 8765 };
  }
}

export async function listCaptureSessions(project: string): Promise<CaptureSessionRow[]> {
  const capDir = path.join(getRepoRoot(), "projects", project, "captures");
  let dirs: string[] = [];
  try {
    dirs = await fs.readdir(capDir);
  } catch {
    return [];
  }
  const rows: CaptureSessionRow[] = [];
  for (const id of dirs) {
    const sessionDir = path.join(capDir, id);
    const session = await readJson<{
      id?: string;
      project?: string;
      label?: string;
      started_at?: string;
      finished_at?: string;
      status?: string;
    }>(path.join(sessionDir, "session.json"), {});
    const index = await readJson<{ transactions?: unknown[] }>(
      path.join(sessionDir, "index.json"),
      { transactions: [] },
    );
    rows.push({
      id: session.id ?? id,
      project: session.project ?? project,
      label: session.label,
      started_at: session.started_at ?? "",
      finished_at: session.finished_at,
      status: session.status ?? "unknown",
      transactionCount: (index.transactions ?? []).length,
    });
  }
  rows.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  return rows;
}

export async function captureStart(
  project: string,
  label: string,
): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  const result = await runPython([
    "-m",
    "atp.cli",
    "capture-start",
    "-p",
    project,
    "--label",
    label,
  ]);
  if (result.code !== 0) {
    return { ok: false, error: result.stderr || result.stdout };
  }
  const rel = result.stdout.trim().replace(/\\/g, "/");
  const sessionId = rel.split("/").pop() ?? rel;
  return { ok: true, sessionId };
}

export function getIngestStatus(): {
  running: boolean;
  project?: string;
  sessionId?: string;
  url?: string;
} {
  if (!ingestState || !isProcessRunning(ingestState.process)) {
    ingestState = null;
    return { running: false };
  }
  const { host, port, project, sessionId } = ingestState;
  return {
    running: true,
    project,
    sessionId,
    url: `http://${host}:${port}/ingest`,
  };
}

export async function captureServeStart(
  project: string,
  sessionId: string,
  port?: number,
): Promise<{ ok: boolean; error?: string; url?: string }> {
  if (ingestState && isProcessRunning(ingestState.process)) {
    if (ingestState.project === project && ingestState.sessionId === sessionId) {
      return { ok: true, url: `http://${ingestState.host}:${ingestState.port}/ingest` };
    }
    return { ok: false, error: "已有 ingest 在运行，请先停止" };
  }
  const cfg = await loadCaptureConfig();
  const host = cfg.ingest_host;
  const usePort = port ?? cfg.ingest_port;
  if (await isPortListening(usePort, host === "0.0.0.0" ? "127.0.0.1" : host)) {
    return {
      ok: false,
      error: `端口 ${usePort} 已被占用。请停止其它 Ingest 或重启电脑后重试。`,
    };
  }
  const args = [
    "-m",
    "atp.cli",
    "capture-serve",
    "-p",
    project,
    sessionId,
    "--host",
    host,
    "--port",
    String(usePort),
  ];
  const child = spawnPythonDetached(args);
  let ingestErr = "";
  child.stderr?.on("data", (d) => {
    ingestErr += d.toString();
  });
  ingestState = { project, sessionId, host, port: usePort, process: child };
  child.on("exit", () => {
    if (ingestState?.process === child) ingestState = null;
  });
  await new Promise((r) => setTimeout(r, 1200));
  const up = await isPortListening(usePort, host === "0.0.0.0" ? "127.0.0.1" : host);
  if (!up) {
    child.kill();
    ingestState = null;
    return { ok: false, error: ingestErr.trim() || `Ingest 未在 ${host}:${usePort} 监听` };
  }
  return { ok: true, url: `http://${host}:${usePort}/ingest` };
}

export async function captureServeStop(closeSession: boolean): Promise<{ ok: boolean }> {
  if (ingestState) {
    ingestState.process.kill();
    const { project, sessionId } = ingestState;
    ingestState = null;
    if (closeSession) {
      await runPython(["-m", "atp.cli", "capture-close", "-p", project, sessionId]);
    }
  }
  return { ok: true };
}

export async function captureClose(project: string, sessionId: string): Promise<{ ok: boolean }> {
  const result = await runPython(["-m", "atp.cli", "capture-close", "-p", project, sessionId]);
  return { ok: result.code === 0 };
}

export async function clearCaptureTransactions(
  project: string,
  sessionId: string,
): Promise<{ ok: boolean; error?: string; removed?: number }> {
  const sessionDir = path.join(getRepoRoot(), "projects", project, "captures", sessionId);
  const indexPath = path.join(sessionDir, "index.json");
  const txDir = path.join(sessionDir, "tx");
  try {
    await fs.access(sessionDir);
  } catch {
    return { ok: false, error: "会话不存在" };
  }
  try {
    const index = await readJson<{ transactions?: unknown[] }>(indexPath, { transactions: [] });
    const removed = (index.transactions ?? []).length;
    try {
      const files = await fs.readdir(txDir);
      await Promise.all(
        files.filter((f) => f.endsWith(".json")).map((f) => fs.unlink(path.join(txDir, f))),
      );
    } catch {
      await fs.mkdir(txDir, { recursive: true });
    }
    await fs.writeFile(indexPath, `${JSON.stringify({ version: 1, transactions: [] }, null, 2)}\n`, "utf8");
    return { ok: true, removed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteCaptureSession(
  project: string,
  sessionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ingest = getIngestStatus();
  if (ingest.running && ingest.project === project && ingest.sessionId === sessionId) {
    return { ok: false, error: "该会话正在抓包，请先停止抓包再删除会话。" };
  }
  const sessionDir = path.join(getRepoRoot(), "projects", project, "captures", sessionId);
  try {
    await fs.rm(sessionDir, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteCaptureSessions(
  project: string,
  sessionIds: string[],
): Promise<{
  ok: boolean;
  deleted: string[];
  failed: Array<{ id: string; error: string }>;
}> {
  const deleted: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const sessionId of [...new Set(sessionIds)]) {
    const res = await deleteCaptureSession(project, sessionId);
    if (res.ok) deleted.push(sessionId);
    else failed.push({ id: sessionId, error: res.error ?? "删除失败" });
  }
  return { ok: failed.length === 0, deleted, failed };
}

export async function getCaptureIndex(
  project: string,
  sessionId: string,
): Promise<{ transactions: CaptureTxIndexRow[] }> {
  const indexPath = path.join(
    getRepoRoot(),
    "projects",
    project,
    "captures",
    sessionId,
    "index.json",
  );
  const index = await readJson<{ transactions?: CaptureTxIndexRow[] }>(indexPath, {
    transactions: [],
  });
  return { transactions: index.transactions ?? [] };
}

export async function getCaptureTransaction(
  project: string,
  sessionId: string,
  txId: string,
): Promise<unknown> {
  const txPath = path.join(
    getRepoRoot(),
    "projects",
    project,
    "captures",
    sessionId,
    "tx",
    `${txId}.json`,
  );
  return readJson(txPath, null);
}

export function sendTestTransaction(
  url: string,
): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
  const sample = {
    request: {
      method: "GET",
      url: "https://httpbin.org/get?from=atp-desktop",
      headers: { "User-Agent": "ATP-Capture-Test" },
    },
    response: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { demo: true },
      duration_ms: 12,
    },
  };
  const payload = JSON.stringify(sample);
  return new Promise((resolve) => {
    const req = http.request(
      url,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          resolve({
            ok: res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", (e) => resolve({ ok: false, error: String(e) }));
    req.write(payload);
    req.end();
  });
}

export function stopIngestOnQuit(): void {
  if (ingestState) {
    ingestState.process.kill();
    ingestState = null;
  }
  void stopMitm();
  void forceDisableSystemProxy();
  void stopPacHttpServer();
}

/** 启动时：MITM 未监听但系统/WinHTTP 仍走 ATP 代理时，自动恢复上网（避免桌面客户端一直 Connecting） */
export async function recoverStaleCaptureProxy(mitmPort = 8888): Promise<string | undefined> {
  if (mitmState || getMitmStatus().running) return undefined;
  const listening = await isPortListening(mitmPort);
  if (listening) return undefined;
  const proxy = readProxyState();
  const winHttp = await getWinHttpProxyStatus();
  const ieStale = isLikelyAtpCaptureProxy(proxy, mitmPort);
  const winHttpStale = winHttpPointsToMitm(winHttp, mitmPort);
  if (!ieStale && !winHttpStale) return undefined;
  const parts: string[] = [];
  if (ieStale) {
    await forceDisableSystemProxy();
    await stopPacHttpServer();
    parts.push("已关闭残留的系统代理/PAC");
  } else if (winHttpStale) {
    await resetWinHttpProxyAlways();
    parts.push("已重置 WinHTTP 代理");
  }
  if (winHttpStale && ieStale) {
    await resetWinHttpProxyAlways();
    parts.push("已重置 WinHTTP");
  }
  parts.push("请完全退出受代理影响的桌面客户端后重新打开");
  return parts.join("；");
}

export async function ensureNetworkDirect(mitmPort = 8888): Promise<{ recovered: boolean; messages: string[] }> {
  const note = await recoverStaleCaptureProxy(mitmPort);
  if (note) return { recovered: true, messages: [note] };
  return { recovered: false, messages: [] };
}

export async function restoreNetworkOnly(): Promise<{ message: string }> {
  await stopMitm();
  const net = await forceDisableSystemProxy();
  await stopPacHttpServer();
  const winHttp = await getWinHttpProxyStatus();
  let extra = "";
  if (winHttpIndicatesCaptureProxy(winHttp, 8888) || winHttpPointsToMitm(winHttp, 8888)) {
    await resetWinHttpProxyAlways();
    extra = "；已重置 WinHTTP（桌面终端）";
  }
  return {
    message: `${net.message}${extra}。若客户端仍显示 Connecting，请完全退出该应用后重开。`,
  };
}

export async function resolveMitmBinary(): Promise<string | null> {
  const root = getRepoRoot();
  const localCandidates = [
    path.join(root, ".venv", "Scripts", "mitmdump.exe"),
    path.join(root, ".venv", "Scripts", "mitmproxy.exe"),
    path.join(root, ".venv", "bin", "mitmdump"),
    path.join(root, ".venv", "bin", "mitmproxy"),
  ];
  for (const p of localCandidates) {
    try {
      await fs.access(p);
      return p;
    } catch {
      /* continue */
    }
  }
  const tryWhere = async (name: string) => {
    try {
      const { stdout } = await execFileAsync(process.platform === "win32" ? "where" : "which", [name], {
        timeout: 5000,
      });
      const line = stdout.trim().split(/\r?\n/)[0];
      return line || null;
    } catch {
      return null;
    }
  };
  return (await tryWhere("mitmdump")) ?? (await tryWhere("mitmproxy"));
}

export async function getMitmAvailability(): Promise<{ available: boolean; binary?: string }> {
  const binary = await resolveMitmBinary();
  return { available: Boolean(binary), binary: binary ?? undefined };
}

export function getMitmStatus(): { running: boolean; listenPort?: number; proxy?: string } {
  if (!mitmState || !isProcessRunning(mitmState.process)) {
    mitmState = null;
    return { running: false };
  }
  const { listenHost, listenPort } = mitmState;
  return { running: true, listenPort, proxy: `${listenHost}:${listenPort}` };
}

export async function startMitm(options: {
  ingestUrl: string;
  hostFilter?: string;
  listenPort?: number;
  setSystemProxy?: boolean;
  proxyMode?: "pac" | "global" | "embedded";
  pacHosts?: string;
}): Promise<{ ok: boolean; error?: string; proxy?: string; systemProxyMessage?: string }> {
  if (mitmState && isProcessRunning(mitmState.process)) {
    return { ok: false, error: "MITM 已在运行" };
  }
  const binary = await resolveMitmBinary();
  if (!binary) {
    return {
      ok: false,
      error: "未找到 mitmdump/mitmproxy。请 pip install -r requirements-capture.txt",
    };
  }
  const listenPort = options.listenPort ?? 8888;
  const listenHost = "127.0.0.1";
  const addon = path.join(getRepoRoot(), "scripts", "mitm_ingest_addon.py");
  try {
    await fs.access(addon);
  } catch {
    return { ok: false, error: `缺少 addon: ${addon}` };
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ATP_INGEST_URL: options.ingestUrl,
    PYTHONUTF8: "1",
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
  };
  // 收录：凡经 mitm 的流量都写入 Ingest（域名仅用于 PAC 路由，不再二次过滤）

  let mitmErr = "";
  const mitmChild = spawn(
    binary,
    [
      "-s",
      addon,
      "--listen-host",
      listenHost,
      "--listen-port",
      String(listenPort),
      "--set",
      "http3=false",
    ],
    {
      cwd: getRepoRoot(),
      env,
      stdio: "pipe",
      windowsHide: true,
    },
  );
  mitmChild.stderr?.on("data", (d) => {
    mitmErr += d.toString();
  });

  mitmState = { listenHost: "127.0.0.1", listenPort, process: mitmChild };
  mitmChild.on("exit", () => {
    if (mitmState?.process === mitmChild) {
      mitmState = null;
      disablePacProxy();
      void restoreWindowsSystemProxy();
    }
  });

  await new Promise((r) => setTimeout(r, 2000));
  const listening = await isPortListening(listenPort);
  if (!listening) {
    mitmChild.kill();
    mitmState = null;
    return {
      ok: false,
      error: (mitmErr.trim() || "mitmdump 启动后立即退出") + "。可在终端执行 .venv\\Scripts\\mitmdump -s scripts\\mitm_ingest_addon.py -p 8888 查看报错",
    };
  }

  let systemProxyMessage: string | undefined;
  if (options.setSystemProxy !== false) {
    const usePac = options.proxyMode !== "global";
    if (usePac) {
      const bypassInput = options.pacHosts?.trim() || options.hostFilter?.trim() || "";
      const isEmbedded = options.proxyMode === "embedded";
      let pacPath: string;
      let pacList: string[];
      if (isEmbedded) {
        pacList = parseCaptureHostList(bypassInput);
        pacPath = await writeEmbeddedWebPacFile(bypassInput, listenPort);
      } else {
        pacList = hostsForPac(bypassInput);
        if (!pacList.length) {
          mitmChild.kill();
          mitmState = null;
          return { ok: false, error: "PAC 模式下请填写要快照的 API 域名（逗号分隔）" };
        }
        try {
          pacPath = await writePacFile(pacList, listenPort);
        } catch (e) {
          mitmChild.kill();
          mitmState = null;
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }
      const pacBody = await fs.readFile(pacPath, "utf8");
      const pacHttp = await startPacHttpServer(pacBody);
      if (!pacHttp.ok || !pacHttp.url) {
        mitmChild.kill();
        mitmState = null;
        return { ok: false, error: pacHttp.error ?? "PAC 本地服务启动失败" };
      }
      const r = enablePacProxy(pacHttp.url);
      let winHttpSync = "";
      const winHttp = await importWinHttpProxyFromIe();
      if (winHttp.ok) winHttpSync = ` ${winHttp.message}`;
      else if (winHttp.message) winHttpSync = ` WinHTTP 同步失败：${winHttp.message}`;
      systemProxyMessage = isEmbedded
        ? `${r.message} 内嵌网页模式：公网 HTTP(S) 走 mitm（内网与本机直连${
            pacList.length ? `；额外直连：${pacList.join(", ")}` : ""
          }）。请先开始抓包再启动目标应用。${winHttpSync}`
        : `${r.message} 已路由域名：${pacList.join(", ")}。未在此列表中的站点不会进流量列表。${winHttpSync}`;
      if (!r.ok) {
        mitmChild.kill();
        mitmState = null;
        return { ok: false, error: r.message };
      }
    } else {
      const r = await setWindowsSystemProxy("127.0.0.1", listenPort);
      systemProxyMessage = `${r.message} HTTPS 需安装 MITM 证书；金融终端请完全退出后重开。`;
      if (!r.ok) {
        mitmChild.kill();
        mitmState = null;
        return { ok: false, error: r.message };
      }
    }
  }
  return { ok: true, proxy: `127.0.0.1:${listenPort}`, systemProxyMessage };
}

export function isDesktopTestIngestUrl(url: string): boolean {
  const u = url.toLowerCase();
  if (u.includes("httpbin.org") && u.includes("from=atp-desktop")) return true;
  if (/^https:\/\/www\.baidu\.com\/?$/i.test(u.trim())) return true;
  return false;
}

export async function countMitmIngestedTransactions(
  project: string,
  sessionId: string,
): Promise<number> {
  const { transactions } = await getCaptureIndex(project, sessionId);
  return transactions.filter((t) => !isDesktopTestIngestUrl(t.url)).length;
}

export async function quickCaptureStart(options: {
  project: string;
  label?: string;
  hostFilter?: string;
  sessionId?: string;
  setSystemProxy?: boolean;
  proxyMode?: "pac" | "global" | "embedded";
}): Promise<{
  ok: boolean;
  sessionId?: string;
  ingestUrl?: string;
  mitmProxy?: string;
  error?: string;
  messages: string[];
}> {
  const messages: string[] = [];
  let sessionId = options.sessionId;
  if (!sessionId) {
    const started = await captureStart(options.project, options.label ?? "");
    if (!started.ok || !started.sessionId) {
      return { ok: false, error: started.error, messages };
    }
    sessionId = started.sessionId;
    messages.push(`会话 ${sessionId}`);
  }

  const ingest = await captureServeStart(options.project, sessionId);
  if (!ingest.ok || !ingest.url) {
    return { ok: false, error: ingest.error, sessionId, messages };
  }
  messages.push(`Ingest ${ingest.url}`);

  if (options.setSystemProxy === false) {
    messages.push(
      "警告：已关闭「自动设置系统代理」，Chrome 不会走 8888，只能看到「测试写入」不会有真实流量。",
    );
  }

  const mitm = await startMitm({
    ingestUrl: ingest.url,
    hostFilter: options.hostFilter,
    setSystemProxy: options.setSystemProxy,
    proxyMode: options.proxyMode,
    pacHosts: options.hostFilter,
  });
  if (!mitm.ok) {
    await captureServeStop(false);
    return { ok: false, error: mitm.error, sessionId, messages };
  }
  messages.push(`MITM ${mitm.proxy}`);
  if (mitm.systemProxyMessage) messages.push(mitm.systemProxyMessage);

  await new Promise((r) => setTimeout(r, 500));
  const baidu = probeHttpsViaMitm("https://www.baidu.com/", 8888);
  await new Promise((r) => setTimeout(r, 2000));
  const mitmRows = await countMitmIngestedTransactions(options.project, sessionId);
  if (baidu.ok) {
    if (mitmRows > 0) {
      messages.push(
        `真实链路正常：MITM→Ingest 已写入 ${mitmRows} 条（不含启动自检 baidu.com）。请保持抓取状态用 Chrome 访问业务站。`,
      );
    } else {
      messages.push(
        `代理可达（${baidu.detail}）但 Ingest 无 MITM 记录。若刚修复过 addon，请停止后重新开始抓包。`,
      );
    }
  } else {
    messages.push(
      `真实流量自检失败：${baidu.detail}。请安装证书；勾选自动系统代理；Chrome 关闭 QUIC 后用 Chrome 访问（不是 Edge/360）。`,
    );
  }

  const proxy = getWindowsProxyStatus();
  if (options.setSystemProxy !== false && !proxy.enabled) {
    messages.push("系统代理未开启，浏览器不会经 MITM。");
  }

  return {
    ok: true,
    sessionId,
    ingestUrl: ingest.url,
    mitmProxy: mitm.proxy,
    messages,
  };
}

export async function stopMitm(): Promise<{ proxyRestore?: string }> {
  if (mitmState) {
    mitmState.process.kill();
    mitmState = null;
  }
  disablePacProxy();
  await stopPacHttpServer();
  const restored = await restoreWindowsSystemProxy();
  return { proxyRestore: restored.message };
}

export async function stopAllCapture(closeSession: boolean): Promise<{ message: string }> {
  await stopMitm();
  await captureServeStop(closeSession);
  await stopPacHttpServer();
  const net = await forceDisableSystemProxy();
  return { message: `已停止抓包。${net.message}` };
}

export function getSystemProxyStatus() {
  return getWindowsProxyStatus();
}

export function getRealTrafficGuide(ingestUrl: string | undefined, mitmPort: number): {
  docPath: string;
  mitmCommand: string;
  steps: string[];
} {
  const root = getRepoRoot();
  const addon = path.join(root, "scripts", "mitm_ingest_addon.py").replace(/\\/g, "/");
  const ingest = ingestUrl ?? "http://127.0.0.1:8765/ingest";
  const mitmCommand =
    `$env:ATP_INGEST_URL="${ingest}"\nmitmdump -s "${addon}" --listen-host 0.0.0.0 --listen-port ${mitmPort}`;
  return {
    docPath: path.join(root, "docs", "CAPTURE-REAL-TRAFFIC.md"),
    mitmCommand,
    steps: [
      "桌面：新建会话 → 启动 Ingest → 启动 MITM 代理",
      `系统代理：127.0.0.1:${mitmPort}（手机用电脑局域网 IP + 同端口）`,
      "证书：点「一键安装 MITM 证书」→ 重启浏览器（备用：mitm.it）",
      "操作浏览器/App 后回到本页查看流量列表",
    ],
  };
}