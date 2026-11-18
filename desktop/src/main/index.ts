import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell } from "electron";
import fs from "node:fs/promises";
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
import * as jmeterRunner from "./jmeterRunner";
import { getRepoRoot, setRepoRoot } from "./repo";
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
    show: false,
    backgroundColor: "#1a1f2c",
    movable: true,
    thickFrame: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("[renderer] did-fail-load", code, desc, url);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[renderer] render-process-gone", details);
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void win.loadURL(rendererUrl).catch((err) => {
      console.error("[renderer] loadURL failed", rendererUrl, err);
    });
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html")).catch((err) => {
      console.error("[renderer] loadFile failed", err);
    });
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();
  void (async () => {
    await session.defaultSession.setProxy({ mode: "direct" });
    await capture.recoverStaleCaptureProxy(8888);
  })();
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
ipcMain.handle("atp:getSuiteCases", (_e, projectId: string, suiteName: string) =>
  atp.getSuiteCases(projectId, suiteName),
);
ipcMain.handle("atp:listSuiteRunTargets", (_e, projectId: string, suiteName: string) =>
  atp.listSuiteRunTargets(projectId, suiteName),
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
ipcMain.handle("atp:deleteRuns", (_e, runIds: string[]) => atp.deleteRuns(runIds));
ipcMain.handle("atp:clearAllRuns", () => atp.clearAllRuns());
ipcMain.handle(
  "atp:runSuite",
  (_e, opts: { project: string; suite: string; env: string }) => atp.runSuite(opts),
);

ipcMain.handle("atp:captureConfig", () => capture.loadCaptureConfig());
ipcMain.handle("atp:getProjectCaptureProfile", (_e, projectId: string) =>
  capture.getProjectCaptureProfile(projectId),
);
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
ipcMain.handle("atp:ensureNetworkDirect", () => capture.ensureNetworkDirect());

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
ipcMain.handle("atp:savePerfReport", (e, projectId: string, report: HttpBenchmarkReport, visualHtml?: string) => {
  const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow() ?? null;
  return perfReports.savePerfReport(projectId, report, visualHtml, win);
});
ipcMain.handle("atp:listPerfReports", (_e, projectId: string, limit?: number) =>
  perfReports.listPerfReports(projectId, limit),
);
ipcMain.handle("atp:loadPerfReports", (_e, projectId: string, files: string[]) =>
  perfReports.loadPerfReports(projectId, files),
);
ipcMain.handle(
  "atp:exportPerfReportPdfDialog",
  (e, projectId: string, visualHtml: string, suggestedFileName: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow() ?? null;
    return perfReports.exportPerfReportPdfDialog(projectId, visualHtml, suggestedFileName, win);
  },
);
ipcMain.handle("atp:getPerfReportsDir", (_e, projectId: string) =>
  perfReports.getPerfReportsDirInfo(projectId),
);
ipcMain.handle("atp:deletePerfReports", (_e, projectId: string, files: string[]) =>
  perfReports.deletePerfReports(projectId, files),
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

ipcMain.handle(
  "atp:writeRepoFile",
  async (_e, relativePath: string, content: string) => {
    try {
      const root = getRepoRoot();
      const full = path.join(root, relativePath.replace(/^[/\\]+/, ""));
      if (!full.startsWith(path.resolve(root))) {
        return { ok: false, error: "路径越界" };
      }
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content.endsWith("\n") ? content : `${content}\n`, "utf8");
      return { ok: true, relativePath: path.relative(root, full).replace(/\\/g, "/") };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

ipcMain.handle(
  "atp:readAbsoluteFile",
  async (_e, filePath: string): Promise<string | null> => {
    try {
      const text = await fs.readFile(filePath, "utf8");
      return text;
    } catch {
      return null;
    }
  },
);

ipcMain.handle("atp:detectJmeter", (_e, jmeterHome?: string) => jmeterRunner.detectJmeter(jmeterHome));
ipcMain.handle("atp:runJmeter", (e, opts: jmeterRunner.RunJmeterOptions) =>
  jmeterRunner.runJmeterTest(opts, (text) => {
    if (!e.sender.isDestroyed()) e.sender.send("atp:jmeterLog", { text });
  }),
);
ipcMain.handle("atp:cancelJmeter", () => jmeterRunner.cancelJmeterRun());
ipcMain.handle("atp:openPath", (_e, targetPath: string) => shell.openPath(targetPath));

ipcMain.handle(
  "atp:pickOpenFile",
  async (
    _e,
    opts: {
      defaultPath?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    },
  ): Promise<{ cancelled?: boolean; filePath?: string }> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return { cancelled: true };
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      defaultPath: opts.defaultPath,
      properties: ["openFile"],
      filters: opts.filters ?? [{ name: "All", extensions: ["*"] }],
    });
    if (canceled || !filePaths[0]) return { cancelled: true };
    return { filePath: filePaths[0] };
  },
);

ipcMain.handle(
  "atp:pickOpenDirectory",
  async (_e, opts: { defaultPath?: string; title?: string }): Promise<{ cancelled?: boolean; dirPath?: string }> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return { cancelled: true };
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      defaultPath: opts.defaultPath,
      title: opts.title ?? "选择文件夹",
      properties: ["openDirectory", "createDirectory"],
    });
    if (canceled || !filePaths[0]) return { cancelled: true };
    return { dirPath: filePaths[0] };
  },
);

ipcMain.handle(
  "atp:saveTextWithDialog",
  async (
    _e,
    opts: { defaultPath?: string; content: string; filters?: Array<{ name: string; extensions: string[] }> },
  ) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return { ok: false, error: "无活动窗口" };
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: opts.defaultPath,
      filters: opts.filters ?? [{ name: "Text", extensions: ["txt"] }],
    });
    if (canceled || !filePath) return { ok: false, cancelled: true };
    try {
      await fs.writeFile(filePath, opts.content.endsWith("\n") ? opts.content : `${opts.content}\n`, "utf8");
      return { ok: true, filePath };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

ipcMain.handle(
  "atp:saveBytesWithDialog",
  async (
    _e,
    opts: {
      defaultPath?: string;
      base64: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    },
  ) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return { ok: false, error: "无活动窗口" };
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: opts.defaultPath,
      filters: opts.filters ?? [{ name: "File", extensions: ["bin"] }],
    });
    if (canceled || !filePath) return { ok: false, cancelled: true };
    try {
      const buf = Buffer.from(opts.base64, "base64");
      await fs.writeFile(filePath, buf);
      return { ok: true, filePath };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);