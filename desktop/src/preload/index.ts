import { contextBridge, ipcRenderer } from "electron";

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
};

export type AtpApi = {
  getWorkspace: () => Promise<{ repoRoot: string; python: string }>;
  setRepoRoot: (root: string) => Promise<{ repoRoot: string; python: string }>;
  listProjects: () => Promise<
    Array<{
      id: string;
      name: string;
      description?: string;
      defaultEnvironment?: string;
    }>
  >;
  listProjectAssets: (projectId: string) => Promise<{
    environments: string[];
    suites: string[];
    cases: string[];
  }>;
  readFile: (relativePath: string) => Promise<string | null>;
  listRuns: (filter?: { project?: string; status?: string; limit?: number }) => Promise<
    Array<{
      id: string;
      project: string;
      suite: string;
      environment: string;
      status: string;
      started_at: string;
      dir: string;
    }>
  >;
  getRunDetail: (runId: string) => Promise<{ summary: unknown; steps: unknown[] }>;
  runSuite: (opts: { project: string; suite: string; env: string }) => Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }>;
  captureConfig: () => Promise<{ ingest_host: string; ingest_port: number }>;
  listCaptureSessions: (project: string) => Promise<CaptureSessionRow[]>;
  captureStart: (project: string, label: string) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  captureServeStart: (
    project: string,
    sessionId: string,
    port?: number,
  ) => Promise<{ ok: boolean; error?: string; url?: string }>;
  captureServeStop: (closeSession: boolean) => Promise<{ ok: boolean }>;
  captureClose: (project: string, sessionId: string) => Promise<{ ok: boolean }>;
  clearCaptureTransactions: (
    project: string,
    sessionId: string,
  ) => Promise<{ ok: boolean; error?: string; removed?: number }>;
  deleteCaptureSession: (project: string, sessionId: string) => Promise<{ ok: boolean; error?: string }>;
  getIngestStatus: () => Promise<{
    running: boolean;
    project?: string;
    sessionId?: string;
    url?: string;
  }>; // sessionId = 当前 ingest 写入的目录
  getCaptureIndex: (
    project: string,
    sessionId: string,
  ) => Promise<{ transactions: CaptureTxIndexRow[] }>;
  getCaptureTransaction: (project: string, sessionId: string, txId: string) => Promise<unknown>;
  sendTestIngest: (ingestUrl: string) => Promise<{ ok: boolean; status?: number; body?: string; error?: string }>;
  mitmAvailability: () => Promise<{ available: boolean; binary?: string }>;
  mitmStatus: () => Promise<{ running: boolean; listenPort?: number; proxy?: string }>;
  mitmStart: (opts: {
    ingestUrl: string;
    hostFilter?: string;
    listenPort?: number;
    setSystemProxy?: boolean;
  }) => Promise<{ ok: boolean; error?: string; proxy?: string; systemProxyMessage?: string }>;
  mitmStop: () => Promise<{ ok: boolean; proxyRestore?: string }>;
  systemProxyStatus: () => Promise<{ enabled: boolean; server: string; autoConfigUrl?: string }>;
  realTrafficGuide: (
    ingestUrl?: string,
    port?: number,
  ) => Promise<{ docPath: string; mitmCommand: string; steps: string[] }>;
  quickCaptureStart: (opts: {
    project: string;
    label?: string;
    hostFilter?: string;
    sessionId?: string;
    setSystemProxy?: boolean;
  }) => Promise<{
    ok: boolean;
    sessionId?: string;
    ingestUrl?: string;
    mitmProxy?: string;
    error?: string;
    messages: string[];
  }>;
  captureDiagnose: (port?: number) => Promise<{
    mitmBinary: string | null;
    mitmRunning: boolean;
    portListening: boolean;
    proxy: { enabled: boolean; server: string };
    ingestRunning: boolean;
    issues: string[];
    fixes: string[];
  }>;
  installMitmCa: () => Promise<{ ok: boolean; message: string; certPath?: string }>;
  copyChromeRestart: () => Promise<{ ok: boolean; message: string }>;
  copyText: (text: string) => Promise<{ ok: boolean }>;
  openMitmIt: () => Promise<void>;
  stopAllCapture: (closeSession: boolean) => Promise<{ message: string }>;
  restoreNetworkOnly: () => Promise<{ message: string }>;
};

const api: AtpApi = {
  getWorkspace: () => ipcRenderer.invoke("atp:getWorkspace"),
  setRepoRoot: (root) => ipcRenderer.invoke("atp:setRepoRoot", root),
  listProjects: () => ipcRenderer.invoke("atp:listProjects"),
  listProjectAssets: (projectId) => ipcRenderer.invoke("atp:listProjectAssets", projectId),
  readFile: (relativePath) => ipcRenderer.invoke("atp:readFile", relativePath),
  listRuns: (filter) => ipcRenderer.invoke("atp:listRuns", filter),
  getRunDetail: (runId) => ipcRenderer.invoke("atp:getRunDetail", runId),
  runSuite: (opts) => ipcRenderer.invoke("atp:runSuite", opts),
  captureConfig: () => ipcRenderer.invoke("atp:captureConfig"),
  listCaptureSessions: (project) => ipcRenderer.invoke("atp:listCaptureSessions", project),
  captureStart: (project, label) => ipcRenderer.invoke("atp:captureStart", project, label),
  captureServeStart: (project, sessionId, port) =>
    ipcRenderer.invoke("atp:captureServeStart", project, sessionId, port),
  captureServeStop: (closeSession) => ipcRenderer.invoke("atp:captureServeStop", closeSession),
  captureClose: (project, sessionId) => ipcRenderer.invoke("atp:captureClose", project, sessionId),
  clearCaptureTransactions: (project, sessionId) =>
    ipcRenderer.invoke("atp:clearCaptureTransactions", project, sessionId),
  deleteCaptureSession: (project, sessionId) =>
    ipcRenderer.invoke("atp:deleteCaptureSession", project, sessionId),
  getIngestStatus: () => ipcRenderer.invoke("atp:getIngestStatus"),
  getCaptureIndex: (project, sessionId) => ipcRenderer.invoke("atp:getCaptureIndex", project, sessionId),
  getCaptureTransaction: (project, sessionId, txId) =>
    ipcRenderer.invoke("atp:getCaptureTransaction", project, sessionId, txId),
  sendTestIngest: (ingestUrl) => ipcRenderer.invoke("atp:sendTestIngest", ingestUrl),
  mitmAvailability: () => ipcRenderer.invoke("atp:mitmAvailability"),
  mitmStatus: () => ipcRenderer.invoke("atp:mitmStatus"),
  mitmStart: (opts) => ipcRenderer.invoke("atp:mitmStart", opts),
  mitmStop: () => ipcRenderer.invoke("atp:mitmStop"),
  systemProxyStatus: () => ipcRenderer.invoke("atp:systemProxyStatus"),
  realTrafficGuide: (ingestUrl, port) => ipcRenderer.invoke("atp:realTrafficGuide", ingestUrl, port),
  quickCaptureStart: (opts) => ipcRenderer.invoke("atp:quickCaptureStart", opts),
  captureDiagnose: (port) => ipcRenderer.invoke("atp:captureDiagnose", port),
  installMitmCa: () => ipcRenderer.invoke("atp:installMitmCa"),
  copyChromeRestart: () => ipcRenderer.invoke("atp:copyChromeRestart"),
  copyText: (text) => ipcRenderer.invoke("atp:copyText", text),
  openMitmIt: () => ipcRenderer.invoke("atp:openMitmIt"),
  stopAllCapture: (closeSession) => ipcRenderer.invoke("atp:stopAllCapture", closeSession),
  restoreNetworkOnly: () => ipcRenderer.invoke("atp:restoreNetworkOnly"),
};

contextBridge.exposeInMainWorld("atp", api);