import { app, BrowserWindow, clipboard, ipcMain, session, shell } from "electron";
import path from "node:path";

// 勿让本机系统代理(8888)劫持 Electron，否则会卡顿/无法拖动窗口
app.commandLine.appendSwitch("no-proxy-server");

import * as atp from "./atpService";
import * as capture from "./captureService";
import { restartChromeForTrustStore } from "./chromeRestart";
import * as mitmCert from "./mitmCert";
import { runCaptureDiagnostics } from "./captureDiagnostics";
import { setRepoRoot } from "./repo";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: "API Test Automation",
    movable: true,
    thickFrame: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  await session.defaultSession.setProxy({ mode: "direct" });
  await capture.recoverStaleCaptureProxy(8888);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  capture.stopIngestOnQuit();
});

ipcMain.handle("atp:getWorkspace", () => atp.getWorkspaceInfo());
ipcMain.handle("atp:setRepoRoot", (_e, root: string) => {
  setRepoRoot(root);
  return atp.getWorkspaceInfo();
});
ipcMain.handle("atp:listProjects", () => atp.listProjects());
ipcMain.handle("atp:listProjectAssets", (_e, projectId: string) =>
  atp.listProjectAssets(projectId),
);
ipcMain.handle("atp:readFile", (_e, relativePath: string) => atp.readTextFile(relativePath));
ipcMain.handle("atp:listRuns", (_e, filter?: { project?: string; status?: string; limit?: number }) =>
  atp.listRuns(filter),
);
ipcMain.handle("atp:getRunDetail", (_e, runId: string) => atp.getRunDetail(runId));
ipcMain.handle(
  "atp:runSuite",
  (_e, opts: { project: string; suite: string; env: string }) => atp.runSuite(opts),
);

ipcMain.handle("atp:captureConfig", () => capture.loadCaptureConfig());
ipcMain.handle("atp:listCaptureSessions", (_e, project: string) =>
  capture.listCaptureSessions(project),
);
ipcMain.handle("atp:captureStart", (_e, project: string, label: string) =>
  capture.captureStart(project, label),
);
ipcMain.handle("atp:captureServeStart", (_e, project: string, sessionId: string, port?: number) =>
  capture.captureServeStart(project, sessionId, port),
);
ipcMain.handle("atp:captureServeStop", (_e, closeSession: boolean) =>
  capture.captureServeStop(closeSession),
);
ipcMain.handle("atp:captureClose", (_e, project: string, sessionId: string) =>
  capture.captureClose(project, sessionId),
);
ipcMain.handle("atp:clearCaptureTransactions", (_e, project: string, sessionId: string) =>
  capture.clearCaptureTransactions(project, sessionId),
);
ipcMain.handle("atp:deleteCaptureSession", (_e, project: string, sessionId: string) =>
  capture.deleteCaptureSession(project, sessionId),
);
ipcMain.handle("atp:getIngestStatus", () => capture.getIngestStatus());
ipcMain.handle("atp:getCaptureIndex", (_e, project: string, sessionId: string) =>
  capture.getCaptureIndex(project, sessionId),
);
ipcMain.handle("atp:getCaptureTransaction", (_e, project: string, sessionId: string, txId: string) =>
  capture.getCaptureTransaction(project, sessionId, txId),
);
ipcMain.handle("atp:sendTestIngest", (_e, ingestUrl: string) => capture.sendTestTransaction(ingestUrl));
ipcMain.handle("atp:mitmAvailability", () => capture.getMitmAvailability());
ipcMain.handle("atp:mitmStatus", () => capture.getMitmStatus());
ipcMain.handle(
  "atp:mitmStart",
  (
    _e,
    opts: { ingestUrl: string; hostFilter?: string; listenPort?: number; setSystemProxy?: boolean },
  ) => capture.startMitm(opts),
);
ipcMain.handle("atp:mitmStop", async () => {
  const r = await capture.stopMitm();
  return { ok: true, ...r };
});
ipcMain.handle("atp:systemProxyStatus", () => capture.getSystemProxyStatus());
ipcMain.handle("atp:realTrafficGuide", (_e, ingestUrl?: string, port?: number) =>
  capture.getRealTrafficGuide(ingestUrl, port ?? 8888),
);
ipcMain.handle("atp:captureDiagnose", (_e, port?: number) => runCaptureDiagnostics(port ?? 8888));
ipcMain.handle(
  "atp:quickCaptureStart",
  (
    _e,
    opts: { project: string; label?: string; hostFilter?: string; sessionId?: string; setSystemProxy?: boolean },
  ) => capture.quickCaptureStart(opts),
);
ipcMain.handle("atp:installMitmCa", () => mitmCert.installMitmCaToUserRoot());
ipcMain.handle("atp:copyText", (_e, text: string) => {
  clipboard.writeText(text);
  return { ok: true };
});

ipcMain.handle("atp:copyChromeRestart", () => {
  const restart = restartChromeForTrustStore();
  if (restart.ok) return { ok: true, message: restart.message };
  clipboard.writeText("chrome://restart");
  return {
    ok: false,
    message: `${restart.message} 已复制 chrome://restart 到剪贴板，请粘贴到地址栏回车。`,
  };
});
ipcMain.handle("atp:openMitmIt", () => mitmCert.openMitmItCertPage());
ipcMain.handle("atp:stopAllCapture", (_e, closeSession: boolean) => capture.stopAllCapture(closeSession));
ipcMain.handle("atp:restoreNetworkOnly", () => capture.restoreNetworkOnly());