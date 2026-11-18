import { app, BrowserWindow, clipboard, ipcMain, session, shell } from "electron";
import path from "node:path";

// 勿让本机系统代理(8888)劫持 Electron，否则会卡顿/无法拖动窗口
app.commandLine.appendSwitch("no-proxy-server");

import * as atp from "./atpService";
import * as capture from "./captureService";
import { restartChromeForTrustStore } from "./chromeRestart";
import * as mitmCert from "./mitmCert";
import { runCaptureDiagnostics } from "./captureDiagnostics";
import * as caseStore from "./caseStore";
import * as envStore from "./envStore";
import * as projectStore from "./projectStore";
import * as collections from "./collectionStore";
import { cancelHttpBenchmark, runHttpBenchmark } from "./httpBenchmark";
import { sendHttpRequest } from "./httpRequest";
import * as wsSession from "./wsSession";
import type { WsConnectPayload, WsSendPayload } from "../shared/apiWorkbenchTypes";
import * as perfReports from "./perfReportStore";
import { setRepoRoot } from "./repo";
import type {
  ApiCollectionFile,
  HttpBenchmarkOptions,
  HttpBenchmarkReport,
  HttpSendPayload,
} from "../shared/apiWorkbenchTypes";

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
  wsSession.wsCloseAll();
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
ipcMain.handle("atp:getProjectVariables", (_e, projectId: string, envName: string) =>
  atp.getProjectVariables(projectId, envName),
);
ipcMain.handle(
  "atp:saveProjectEnvLocal",
  (_e, projectId: string, envName: string, variables: Record<string, string>) =>
    envStore.saveProjectEnvLocal(projectId, envName, variables),
);
ipcMain.handle(
  "atp:createProjectEnvironment",
  (
    _e,
    projectId: string,
    envName: string,
    opts?: { copyFrom?: string; baseUrl?: string },
  ) => envStore.createProjectEnvironment(projectId, envName, opts),
);
ipcMain.handle(
  "atp:createProject",
  (_e, opts: { id: string; name?: string; baseUrl?: string }) => projectStore.createProject(opts),
);
ipcMain.handle("atp:deleteProject", (_e, projectId: string) => {
  const ingest = capture.getIngestStatus();
  if (ingest.running && ingest.project === projectId) {
    return Promise.resolve({ ok: false, error: "该项目正在抓包，请先停止抓包再删除。" });
  }
  return projectStore.deleteProject(projectId);
});
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
ipcMain.handle("atp:deleteCaptureSessions", (_e, project: string, sessionIds: string[]) =>
  capture.deleteCaptureSessions(project, sessionIds),
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

ipcMain.handle("atp:listCollections", (_e, projectId: string) => collections.listCollections(projectId));
ipcMain.handle("atp:getCollection", (_e, projectId: string, collectionId: string) =>
  collections.getCollection(projectId, collectionId),
);
ipcMain.handle("atp:saveCollection", (_e, projectId: string, collection: ApiCollectionFile) =>
  collections.saveCollection(projectId, collection),
);
ipcMain.handle("atp:ensureCollection", (_e, projectId: string, collectionId: string) =>
  collections.ensureCollection(projectId, collectionId),
);
ipcMain.handle("atp:deleteCollection", (_e, projectId: string, collectionId: string) =>
  collections.deleteCollection(projectId, collectionId),
);
ipcMain.handle("atp:sendHttpRequest", (_e, payload: HttpSendPayload) => sendHttpRequest(payload));
ipcMain.handle("atp:wsConnect", (e, payload: WsConnectPayload) =>
  wsSession.wsConnect(payload, e.sender),
);
ipcMain.handle("atp:wsSend", (_e, payload: WsSendPayload) => wsSession.wsSend(payload));
ipcMain.handle("atp:wsClose", (_e, connectionId: string) => wsSession.wsClose(connectionId));
ipcMain.handle(
  "atp:runHttpBenchmark",
  (
    _e,
    payload: HttpSendPayload,
    options: HttpBenchmarkOptions,
    meta?: { name?: string },
  ) => runHttpBenchmark(payload, options, meta),
);
ipcMain.handle("atp:cancelHttpBenchmark", () => {
  cancelHttpBenchmark();
  return { ok: true };
});
ipcMain.handle("atp:savePerfReport", (_e, projectId: string, report: HttpBenchmarkReport) =>
  perfReports.savePerfReport(projectId, report),
);
ipcMain.handle("atp:listPerfReports", (_e, projectId: string, limit?: number) =>
  perfReports.listPerfReports(projectId, limit),
);
ipcMain.handle(
  "atp:saveProjectCase",
  (
    _e,
    projectId: string,
    caseName: string,
    yamlContent: string,
    options?: { addToSuite?: string; overwrite?: boolean },
  ) => caseStore.saveProjectCase(projectId, caseName, yamlContent, options),
);
ipcMain.handle("atp:updateProjectCase", (_e, projectId: string, caseName: string, yamlContent: string) =>
  caseStore.updateProjectCase(projectId, caseName, yamlContent),
);
ipcMain.handle("atp:projectCaseExists", (_e, projectId: string, caseName: string) =>
  caseStore.projectCaseExists(projectId, caseName),
);
ipcMain.handle("atp:deleteProjectCase", (_e, projectId: string, caseName: string) =>
  caseStore.deleteProjectCase(projectId, caseName),
);