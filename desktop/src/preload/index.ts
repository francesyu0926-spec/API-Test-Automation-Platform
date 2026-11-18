import { contextBridge, ipcRenderer } from "electron";

import type {
  ApiCollectionFile,
  HttpBenchmarkOptions,
  HttpBenchmarkReport,
  HttpSendPayload,
  HttpSendResult,
  WsConnectPayload,
  WsEvent,
  WsSendPayload,
} from "../shared/apiWorkbenchTypes";

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
  getSuiteCases: (
    projectId: string,
    suiteName: string,
  ) => Promise<{ name: string; description?: string; cases: string[] }>;
  listSuiteRunTargets: (
    projectId: string,
    suiteName: string,
  ) => Promise<{
    name: string;
    description?: string;
    targets: Array<
      | { kind: "case"; key: string; id: string; label: string }
      | { kind: "collection"; key: string; collectionId: string; requestId: string; label: string }
    >;
  }>;
  getProjectVariables: (projectId: string, envName: string) => Promise<Record<string, string>>;
  saveProjectEnvLocal: (
    projectId: string,
    envName: string,
    variables: Record<string, string>,
  ) => Promise<{ ok: boolean; relativePath: string }>;
  createProjectEnvironment: (
    projectId: string,
    envName: string,
    opts?: { copyFrom?: string; baseUrl?: string },
  ) => Promise<{ ok: boolean; error?: string; envName?: string }>;
  createProject: (opts: {
    id: string;
    name?: string;
    baseUrl?: string;
  }) => Promise<{ ok: boolean; error?: string; projectId?: string }>;
  deleteProject: (projectId: string) => Promise<{ ok: boolean; error?: string }>;
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
  deleteRuns: (runIds: string[]) => Promise<{ ok: boolean; deleted: number; errors: string[] }>;
  clearAllRuns: () => Promise<{ ok: boolean; deleted: number; error?: string }>;
  runSuite: (opts: {
    project: string;
    suite: string;
    env: string;
    cases?: string[];
  }) => Promise<{
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
  deleteCaptureSessions: (
    project: string,
    sessionIds: string[],
  ) => Promise<{
    ok: boolean;
    deleted: string[];
    failed: Array<{ id: string; error: string }>;
  }>;
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
  ensureNetworkDirect: () => Promise<{ recovered: boolean; messages: string[] }>;
  listCollections: (projectId: string) => Promise<
    Array<{ id: string; name: string; requestCount: number }>
  >;
  getCollection: (projectId: string, collectionId: string) => Promise<ApiCollectionFile | null>;
  saveCollection: (projectId: string, collection: ApiCollectionFile) => Promise<{ ok: boolean }>;
  ensureCollection: (projectId: string, collectionId: string) => Promise<ApiCollectionFile>;
  deleteCollection: (
    projectId: string,
    collectionId: string,
  ) => Promise<{ ok: boolean; error?: string; recreatedDefault?: boolean }>;
  sendHttpRequest: (payload: HttpSendPayload) => Promise<HttpSendResult>;
  wsConnect: (payload: WsConnectPayload) => Promise<{ ok: boolean; error?: string }>;
  wsSend: (payload: WsSendPayload) => Promise<{ ok: boolean; error?: string }>;
  wsClose: (connectionId: string) => Promise<{ ok: boolean }>;
  onWsEvent: (handler: (ev: WsEvent) => void) => () => void;
  runHttpBenchmark: (
    payload: HttpSendPayload,
    options: HttpBenchmarkOptions,
    meta?: { name?: string },
  ) => Promise<HttpBenchmarkReport>;
  cancelHttpBenchmark: () => Promise<{ ok: boolean }>;
  savePerfReport: (
    projectId: string,
    report: HttpBenchmarkReport,
    visualHtml?: string,
  ) => Promise<{
    ok: boolean;
    relativePath: string;
    pdfFilePath?: string;
    cancelled?: boolean;
    error?: string;
  }>;
  listPerfReports: (
    projectId: string,
    limit?: number,
  ) => Promise<
    Array<{
      id: string;
      file: string;
      startedAt: string;
      method: string;
      url: string;
      name?: string;
      samples: number;
      success: number;
      failed: number;
      rps: number;
    }>
  >;
  loadPerfReports: (projectId: string, files: string[]) => Promise<HttpBenchmarkReport[]>;
  exportPerfReportPdfDialog: (
    projectId: string,
    visualHtml: string,
    suggestedFileName: string,
  ) => Promise<{ ok: boolean; pdfFilePath?: string; cancelled?: boolean; error?: string }>;
  getPerfReportsDir: (projectId: string) => Promise<{ absolute: string; relative: string }>;
  deletePerfReports: (
    projectId: string,
    files: string[],
  ) => Promise<{ ok: boolean; deleted: number; error?: string }>;
  saveProjectCase: (
    projectId: string,
    caseName: string,
    yamlContent: string,
    options?: { addToSuite?: string; overwrite?: boolean },
  ) => Promise<{ ok: boolean; error?: string; relativePath?: string; caseName?: string; exists?: boolean }>;
  projectCaseExists: (projectId: string, caseName: string) => Promise<boolean>;
  updateProjectCase: (
    projectId: string,
    caseName: string,
    yamlContent: string,
  ) => Promise<{ ok: boolean; error?: string; relativePath?: string }>;
  deleteProjectCase: (projectId: string, caseName: string) => Promise<{ ok: boolean; error?: string }>;
  writeRepoFile: (
    relativePath: string,
    content: string,
  ) => Promise<{ ok: boolean; error?: string; relativePath?: string }>;
  saveTextWithDialog: (opts: {
    defaultPath?: string;
    content: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => Promise<{ ok: boolean; error?: string; cancelled?: boolean; filePath?: string }>;
  readAbsoluteFile: (filePath: string) => Promise<string | null>;
  pickOpenFile: (opts: {
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => Promise<{ cancelled?: boolean; filePath?: string }>;
  pickOpenDirectory: (opts?: {
    defaultPath?: string;
    title?: string;
  }) => Promise<{ cancelled?: boolean; dirPath?: string }>;
  detectJmeter: (jmeterHome?: string) => Promise<{
    found: boolean;
    jmeterHome?: string;
    jmeterBin?: string;
    error?: string;
  }>;
  runJmeter: (opts: {
    jmxPath: string;
    outputDir?: string;
    jmeterHome?: string;
    generateReport?: boolean;
  }) => Promise<{
    ok: boolean;
    cancelled?: boolean;
    exitCode?: number | null;
    jmxPath: string;
    outputDir: string;
    jtlPath: string;
    reportDir?: string;
    logPath: string;
    stdout: string;
    stderr: string;
    error?: string;
  }>;
  cancelJmeter: () => Promise<{ ok: boolean }>;
  onJmeterLog: (handler: (ev: { text: string }) => void) => () => void;
  openPath: (targetPath: string) => Promise<string>;
};

const api: AtpApi = {
  getWorkspace: () => ipcRenderer.invoke("atp:getWorkspace"),
  setRepoRoot: (root) => ipcRenderer.invoke("atp:setRepoRoot", root),
  listProjects: () => ipcRenderer.invoke("atp:listProjects"),
  listProjectAssets: (projectId) => ipcRenderer.invoke("atp:listProjectAssets", projectId),
  getSuiteCases: (projectId, suiteName) =>
    ipcRenderer.invoke("atp:getSuiteCases", projectId, suiteName),
  listSuiteRunTargets: (projectId, suiteName) =>
    ipcRenderer.invoke("atp:listSuiteRunTargets", projectId, suiteName),
  getProjectVariables: (projectId, envName) =>
    ipcRenderer.invoke("atp:getProjectVariables", projectId, envName),
  saveProjectEnvLocal: (projectId, envName, variables) =>
    ipcRenderer.invoke("atp:saveProjectEnvLocal", projectId, envName, variables),
  createProjectEnvironment: (projectId, envName, opts) =>
    ipcRenderer.invoke("atp:createProjectEnvironment", projectId, envName, opts),
  createProject: (opts) => ipcRenderer.invoke("atp:createProject", opts),
  deleteProject: (projectId) => ipcRenderer.invoke("atp:deleteProject", projectId),
  readFile: (relativePath) => ipcRenderer.invoke("atp:readFile", relativePath),
  listRuns: (filter) => ipcRenderer.invoke("atp:listRuns", filter),
  getRunDetail: (runId) => ipcRenderer.invoke("atp:getRunDetail", runId),
  deleteRuns: (runIds) => ipcRenderer.invoke("atp:deleteRuns", runIds),
  clearAllRuns: () => ipcRenderer.invoke("atp:clearAllRuns"),
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
  deleteCaptureSessions: (project, sessionIds) =>
    ipcRenderer.invoke("atp:deleteCaptureSessions", project, sessionIds),
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
  ensureNetworkDirect: () => ipcRenderer.invoke("atp:ensureNetworkDirect"),
  listCollections: (projectId) => ipcRenderer.invoke("atp:listCollections", projectId),
  getCollection: (projectId, collectionId) => ipcRenderer.invoke("atp:getCollection", projectId, collectionId),
  saveCollection: (projectId, collection) => ipcRenderer.invoke("atp:saveCollection", projectId, collection),
  ensureCollection: (projectId, collectionId) =>
    ipcRenderer.invoke("atp:ensureCollection", projectId, collectionId),
  deleteCollection: (projectId, collectionId) =>
    ipcRenderer.invoke("atp:deleteCollection", projectId, collectionId),
  sendHttpRequest: (payload) => ipcRenderer.invoke("atp:sendHttpRequest", payload),
  wsConnect: (payload) => ipcRenderer.invoke("atp:wsConnect", payload),
  wsSend: (payload) => ipcRenderer.invoke("atp:wsSend", payload),
  wsClose: (connectionId) => ipcRenderer.invoke("atp:wsClose", connectionId),
  onWsEvent: (handler) => {
    const listener = (_: unknown, ev: WsEvent) => handler(ev);
    ipcRenderer.on("atp:wsEvent", listener);
    return () => ipcRenderer.removeListener("atp:wsEvent", listener);
  },
  runHttpBenchmark: (payload, options, meta) =>
    ipcRenderer.invoke("atp:runHttpBenchmark", payload, options, meta),
  cancelHttpBenchmark: () => ipcRenderer.invoke("atp:cancelHttpBenchmark"),
  savePerfReport: (projectId, report, visualHtml) =>
    ipcRenderer.invoke("atp:savePerfReport", projectId, report, visualHtml),
  listPerfReports: (projectId, limit) => ipcRenderer.invoke("atp:listPerfReports", projectId, limit),
  loadPerfReports: (projectId, files) => ipcRenderer.invoke("atp:loadPerfReports", projectId, files),
  exportPerfReportPdfDialog: (projectId, visualHtml, suggestedFileName) =>
    ipcRenderer.invoke("atp:exportPerfReportPdfDialog", projectId, visualHtml, suggestedFileName),
  getPerfReportsDir: (projectId) => ipcRenderer.invoke("atp:getPerfReportsDir", projectId),
  deletePerfReports: (projectId, files) => ipcRenderer.invoke("atp:deletePerfReports", projectId, files),
  saveProjectCase: (projectId, caseName, yamlContent, options) =>
    ipcRenderer.invoke("atp:saveProjectCase", projectId, caseName, yamlContent, options),
  projectCaseExists: (projectId, caseName) => ipcRenderer.invoke("atp:projectCaseExists", projectId, caseName),
  updateProjectCase: (projectId, caseName, yamlContent) =>
    ipcRenderer.invoke("atp:updateProjectCase", projectId, caseName, yamlContent),
  deleteProjectCase: (projectId, caseName) => ipcRenderer.invoke("atp:deleteProjectCase", projectId, caseName),
  writeRepoFile: (relativePath, content) => ipcRenderer.invoke("atp:writeRepoFile", relativePath, content),
  saveTextWithDialog: (opts) => ipcRenderer.invoke("atp:saveTextWithDialog", opts),
  readAbsoluteFile: (filePath) => ipcRenderer.invoke("atp:readAbsoluteFile", filePath),
  pickOpenFile: (opts) => ipcRenderer.invoke("atp:pickOpenFile", opts),
  pickOpenDirectory: (opts) => ipcRenderer.invoke("atp:pickOpenDirectory", opts),
  detectJmeter: (jmeterHome) => ipcRenderer.invoke("atp:detectJmeter", jmeterHome),
  runJmeter: (opts) => ipcRenderer.invoke("atp:runJmeter", opts),
  cancelJmeter: () => ipcRenderer.invoke("atp:cancelJmeter"),
  onJmeterLog: (handler) => {
    const listener = (_: unknown, ev: { text: string }) => handler(ev);
    ipcRenderer.on("atp:jmeterLog", listener);
    return () => ipcRenderer.removeListener("atp:jmeterLog", listener);
  },
  openPath: (targetPath) => ipcRenderer.invoke("atp:openPath", targetPath),
};

contextBridge.exposeInMainWorld("atp", api);