import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ApiCollectionFile, HttpSendResult, WsEvent, WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import PerfPanel from "./PerfPanel";
import ConfirmDialog from "./ConfirmDialog";
import SaveCaseDialog from "./SaveCaseDialog";
import { workbenchDraftToCaseYaml } from "./caseYaml";
import ImportCurlDialog from "./ImportCurlDialog";
import CreateEnvDialog from "./CreateEnvDialog";
import EnvVariablesDialog, { collectTemplateVarNames } from "./EnvVariablesDialog";
import LoadingOverlay from "./LoadingOverlay";
import { substituteVars } from "../../shared/vars";
import { resolveWorkbenchPayload, resolveWorkbenchWsConnect } from "./resolveWorkbenchRequest";
import { originFromRequestUrl } from "./urlOrigin";
import {
  HTTP_METHODS,
  buildUrl,
  defaultDraft,
  draftToSavedRequest,
  emptyRow,
  formatJsonBody,
  httpEmptyBodyHint,
  httpStatusTone,
  normalizeRawBodyDraft,
  savedRequestToDraft,
} from "./apiWorkbenchModel";

type Props = {
  project: string;
  projects: { id: string; name: string }[];
  onProject: (id: string) => void;
  externalDraft: WorkbenchDraft | null;
  onConsumeExternalDraft: () => void;
  onCaseSaved?: () => void;
  onRequestCreateProject?: (suggestedBaseUrl?: string) => void;
};

type ReqTab = "params" | "headers" | "body" | "perf";
type Protocol = "http" | "ws";

type WsLogLine = {
  at: string;
  kind: "sys" | "in" | "out" | "err";
  text: string;
};

function isWsUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  return u.startsWith("ws://") || u.startsWith("wss://");
}

function formatWsTime(): string {
  const d = new Date();
  return d.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function ApiWorkbench({
  project,
  projects,
  onProject,
  externalDraft,
  onConsumeExternalDraft,
  onCaseSaved,
  onRequestCreateProject,
}: Props) {
  const [collections, setCollections] = useState<Awaited<ReturnType<typeof window.atp.listCollections>>>([]);
  const [collectionId, setCollectionId] = useState("default");
  const [collection, setCollection] = useState<ApiCollectionFile | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkbenchDraft>(defaultDraft());
  const [reqTab, setReqTab] = useState<ReqTab>("params");
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<HttpSendResult | null>(null);
  const [respView, setRespView] = useState<"body" | "headers">("body");
  const [toast, setToast] = useState("");
  const [saveCaseOpen, setSaveCaseOpen] = useState(false);
  const [envName, setEnvName] = useState("dev");
  const [environments, setEnvironments] = useState<string[]>(["dev"]);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [envDialogOpen, setEnvDialogOpen] = useState(false);
  const [createEnvOpen, setCreateEnvOpen] = useState(false);
  const [pendingCollectionDelete, setPendingCollectionDelete] = useState(false);
  const [pendingFolderDelete, setPendingFolderDelete] = useState<string | null>(null);
  const [pendingRequestDelete, setPendingRequestDelete] = useState<string | null>(null);
  const [importCurlOpen, setImportCurlOpen] = useState(false);
  const [pendingCaseOverwrite, setPendingCaseOverwrite] = useState<{
    caseName: string;
    addToSuite: boolean;
    suiteName: string;
    yaml: string;
  } | null>(null);
  const [protocol, setProtocol] = useState<Protocol>("http");
  const wsConnectionId = useRef(crypto.randomUUID().slice(0, 16));
  const [wsOpen, setWsOpen] = useState(false);
  const [wsConnecting, setWsConnecting] = useState(false);
  const [wsLog, setWsLog] = useState<WsLogLine[]>([]);
  const [workbenchLoading, setWorkbenchLoading] = useState(false);
  const [variablesLoading, setVariablesLoading] = useState(false);

  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 2600);
  };

  const loadCollections = useCallback(async () => {
    if (!project) return;
    const list = await window.atp.listCollections(project);
    setCollections(list);
    if (!list.some((c) => c.id === collectionId) && list.length) {
      setCollectionId(list[0].id);
    }
    if (!list.length) {
      await window.atp.ensureCollection(project, "default");
      const again = await window.atp.listCollections(project);
      setCollections(again);
    }
  }, [project, collectionId]);

  const effectiveCollectionId = useMemo(() => {
    if (!collections.length) return collectionId || "default";
    return collections.some((c) => c.id === collectionId) ? collectionId : collections[0].id;
  }, [collections, collectionId]);

  useEffect(() => {
    if (!project || !collections.length) return;
    if (effectiveCollectionId !== collectionId) {
      setCollectionId(effectiveCollectionId);
    }
  }, [project, collections, collectionId, effectiveCollectionId]);

  const loadCollection = useCallback(async () => {
    if (!project || !effectiveCollectionId) return;
    setWorkbenchLoading(true);
    try {
      const doc = await window.atp.getCollection(project, effectiveCollectionId);
      if (doc) setCollection(doc);
      else {
        const created = await window.atp.ensureCollection(project, effectiveCollectionId);
        setCollection(created);
      }
    } finally {
      setWorkbenchLoading(false);
    }
  }, [project, effectiveCollectionId]);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  const refreshEnvironments = useCallback(async () => {
    if (!project) {
      setEnvironments(["dev"]);
      return;
    }
    const assets = await window.atp.listProjectAssets(project);
    const envs = assets.environments.length ? assets.environments : ["dev"];
    setEnvironments(envs);
    setEnvName((prev) => (envs.includes(prev) ? prev : envs[0]));
  }, [project]);

  useEffect(() => {
    void refreshEnvironments();
  }, [refreshEnvironments]);

  useEffect(() => {
    if (!project || !envName) return;
    setVariablesLoading(true);
    void window.atp
      .getProjectVariables(project, envName)
      .then(setVariables)
      .finally(() => setVariablesLoading(false));
  }, [project, envName]);

  const appendWsLog = useCallback((kind: WsLogLine["kind"], text: string) => {
    setWsLog((prev) => [...prev, { at: formatWsTime(), kind, text }]);
  }, []);

  const resetWsSession = useCallback(() => {
    void window.atp.wsClose(wsConnectionId.current);
    wsConnectionId.current = crypto.randomUUID().slice(0, 16);
    setWsOpen(false);
    setWsConnecting(false);
    setWsLog([]);
  }, []);

  useEffect(() => {
    const unsub = window.atp.onWsEvent((ev: WsEvent) => {
      if (ev.connectionId !== wsConnectionId.current) return;
      if (ev.type === "open") {
        setWsConnecting(false);
        setWsOpen(true);
        appendWsLog("sys", "已连接 (OPEN)");
      } else if (ev.type === "message") {
        const prefix = ev.binary ? `[binary ${ev.binarySize ?? 0} B] ` : "";
        appendWsLog("in", `${prefix}${ev.data ?? ""}`);
      } else if (ev.type === "close") {
        setWsOpen(false);
        setWsConnecting(false);
        appendWsLog("sys", `连接关闭 code=${ev.code ?? ""} ${ev.reason ?? ""}`.trim());
      } else if (ev.type === "error") {
        setWsConnecting(false);
        appendWsLog("err", ev.error ?? "未知错误");
      }
    });
    return unsub;
  }, [appendWsLog]);

  useEffect(() => {
    const u = draft.url.trim();
    if (isWsUrl(u)) setProtocol("ws");
  }, [draft.url]);

  useEffect(() => {
    if (protocol !== "http") return;
    resetWsSession();
  }, [protocol, resetWsSession]);

  useEffect(() => {
    if (protocol === "ws" && reqTab === "perf") setReqTab("params");
  }, [protocol, reqTab]);

  useEffect(() => {
    void loadCollection();
  }, [loadCollection]);

  useEffect(() => {
    if (!externalDraft) return;
    const normalized = normalizeRawBodyDraft(externalDraft);
    setDraft(normalized);
    setActiveRequestId(null);
    setResponse(null);
    resetWsSession();
    if (isWsUrl(normalized.url)) setProtocol("ws");
    else setProtocol("http");
    onConsumeExternalDraft();
    showToast("已从抓包载入请求");
  }, [externalDraft, onConsumeExternalDraft, resetWsSession]);

  const folderGroups = useMemo(() => {
    const reqs = collection?.requests ?? [];
    const folders = new Set<string>();
    for (const f of collection?.folders ?? []) folders.add(f);
    for (const r of reqs) {
      if (r.folder) folders.add(r.folder);
    }
    const sorted = [...folders].sort((a, b) => a.localeCompare(b, "zh"));
    const groups: Array<{ folder: string; requests: typeof reqs }> = sorted.map((folder) => ({
      folder,
      requests: reqs.filter((r) => r.folder === folder),
    }));
    const root = reqs.filter((r) => !r.folder);
    if (root.length) groups.unshift({ folder: "", requests: root });
    return groups;
  }, [collection]);

  const openRequest = (id: string) => {
    const req = collection?.requests.find((r) => r.id === id);
    if (!req) {
      showToast("未找到该请求，正在刷新…");
      void loadCollection();
      return;
    }
    setActiveRequestId(id);
    const nextDraft = savedRequestToDraft(req);
    setDraft(nextDraft);
    setResponse(null);
    resetWsSession();
    if (req.method === "WS" || isWsUrl(nextDraft.url)) setProtocol("ws");
    else setProtocol("http");
  };

  const newRequest = () => {
    setActiveRequestId(null);
    setDraft(defaultDraft());
    setResponse(null);
    setProtocol("http");
    resetWsSession();
  };

  const updateQueryRow = (index: number, patch: Partial<(typeof draft.query)[0]>) => {
    setDraft((d) => {
      const query = d.query.map((row, i) => (i === index ? { ...row, ...patch } : row));
      return { ...d, query };
    });
  };

  const updateHeaderRow = (index: number, patch: Partial<(typeof draft.headers)[0]>) => {
    setDraft((d) => {
      const headers = d.headers.map((row, i) => (i === index ? { ...row, ...patch } : row));
      return { ...d, headers };
    });
  };

  const onWsConnect = async () => {
    let resolvedUrl = "";
    try {
      resolvedUrl = resolveWorkbenchWsConnect(draft, variables).url;
    } catch {
      resolvedUrl = "";
    }
    if (!resolvedUrl.trim()) {
      showToast("请填写 WebSocket URL (ws:// 或 wss://)");
      return;
    }
    if (!isWsUrl(resolvedUrl)) {
      showToast("WebSocket URL 须以 ws:// 或 wss:// 开头");
      return;
    }
    setWsLog([]);
    setWsConnecting(true);
    setWsOpen(false);
    try {
      const { url: resolvedUrl, headers } = resolveWorkbenchWsConnect(draft, variables);
      appendWsLog("sys", `连接 ${resolvedUrl}`);
      const res = await window.atp.wsConnect({
        connectionId: wsConnectionId.current,
        url: resolvedUrl,
        headers,
      });
      if (!res.ok) {
        setWsConnecting(false);
        appendWsLog("err", res.error ?? "连接失败");
        showToast(res.error ?? "连接失败");
        if ((res.error ?? "").includes("未定义变量")) setEnvDialogOpen(true);
      }
    } catch (err) {
      setWsConnecting(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("未定义变量")) setEnvDialogOpen(true);
      appendWsLog("err", msg);
      showToast(msg);
    }
  };

  const onWsDisconnect = () => {
    void window.atp.wsClose(wsConnectionId.current);
    setWsOpen(false);
    setWsConnecting(false);
    appendWsLog("sys", "已主动断开");
  };

  const onWsSend = async () => {
    if (!wsOpen) {
      showToast("请先连接 WebSocket");
      return;
    }
    let data = draft.body || "";
    if (data) {
      try {
        data = substituteVars(data, variables);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("未定义变量")) setEnvDialogOpen(true);
        showToast(msg);
        return;
      }
    }
    if (!data) {
      showToast("请在 Body 中填写要发送的消息");
      return;
    }
    const res = await window.atp.wsSend({ connectionId: wsConnectionId.current, data });
    if (!res.ok) {
      showToast(res.error ?? "发送失败");
      appendWsLog("err", res.error ?? "发送失败");
      return;
    }
    appendWsLog("out", data);
  };

  const onSend = async () => {
    if (protocol === "ws") {
      await onWsSend();
      return;
    }
    if (!buildUrl(draft.url, draft.query).trim() && !draft.url.trim()) {
      showToast("请填写 URL");
      return;
    }
    setSending(true);
    setResponse(null);
    try {
      const payload = resolveWorkbenchPayload(draft, variables);
      const res = await window.atp.sendHttpRequest(payload);
      setResponse(res);
      if (res.error) showToast(res.error);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("未定义变量")) setEnvDialogOpen(true);
      setResponse({
        ok: false,
        status: 0,
        statusText: "",
        durationMs: 0,
        headers: {},
        bodyText: msg,
        bodySize: 0,
        error: msg,
      });
      showToast(msg);
    } finally {
      setSending(false);
    }
  };

  const saveCurrent = async () => {
    if (!project) {
      showToast(projects.length ? "请先在上方工作区选择项目" : "请先新建项目后再保存到集合");
      openCreateProject();
      return;
    }
    const url = draft.url.trim() || buildUrl(draft.url, draft.query).trim();
    if (!url) {
      showToast("请填写 URL 后再保存");
      return;
    }
    let col = collection;
    const moduleId = effectiveCollectionId || collections[0]?.id || "default";
    if (!col) {
      try {
        col = (await window.atp.getCollection(project, moduleId)) ?? (await window.atp.ensureCollection(project, moduleId));
        setCollection(col);
        if (moduleId !== collectionId) setCollectionId(moduleId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(msg || "无法加载集合模块");
        return;
      }
    }
    const id = activeRequestId ?? crypto.randomUUID().slice(0, 12);
    const normalized = normalizeRawBodyDraft({
      ...draft,
      name: draft.name || "未命名请求",
      method: protocol === "ws" ? "WS" : draft.method,
    });
    const saved = draftToSavedRequest(id, normalized);
    const folders = new Set(col.folders ?? []);
    if (saved.folder) folders.add(saved.folder);
    const others = col.requests.filter((r) => r.id !== id);
    const next: ApiCollectionFile = {
      ...col,
      folders: [...folders].sort((a, b) => a.localeCompare(b, "zh")),
      requests: [...others, saved],
    };
    try {
      await window.atp.saveCollection(project, next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg || "保存失败");
      return;
    }
    setCollection(next);
    setActiveRequestId(id);
    showToast("已保存到集合");
    await loadCollections();
  };

  const deleteFolder = async (folderName: string) => {
    if (!project || !collection || !folderName) return;
    const removed = collection.requests.filter((r) => r.folder === folderName);
    const next: ApiCollectionFile = {
      ...collection,
      folders: (collection.folders ?? []).filter((f) => f !== folderName),
      requests: collection.requests.filter((r) => r.folder !== folderName),
    };
    await window.atp.saveCollection(project, next);
    setCollection(next);
    if (activeRequestId && removed.some((r) => r.id === activeRequestId)) {
      setActiveRequestId(null);
      setDraft(defaultDraft());
      setResponse(null);
    }
    setPendingFolderDelete(null);
    showToast(
      removed.length
        ? `已删除分组「${folderName}」及其中 ${removed.length} 个请求`
        : `已删除空分组「${folderName}」`,
    );
    await loadCollections();
  };

  const deleteRequestById = async (id: string) => {
    if (!project) {
      showToast("请先选择项目");
      return;
    }
    let col = collection;
    if (!col) {
      try {
        col =
          (await window.atp.getCollection(project, effectiveCollectionId)) ??
          (await window.atp.ensureCollection(project, effectiveCollectionId));
        setCollection(col);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(msg || "无法加载集合");
        return;
      }
    }
    const target = col.requests.find((r) => r.id === id);
    if (!target) {
      showToast("请求不存在或已被删除");
      setPendingRequestDelete(null);
      await loadCollection();
      return;
    }
    const next: ApiCollectionFile = {
      ...col,
      requests: col.requests.filter((r) => r.id !== id),
    };
    try {
      await window.atp.saveCollection(project, next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg || "删除失败");
      return;
    }
    setCollection(next);
    if (activeRequestId === id) {
      setActiveRequestId(null);
      setDraft(defaultDraft());
      setResponse(null);
    }
    setPendingRequestDelete(null);
    showToast(`已删除「${target.name}」`);
    await loadCollections();
  };

  const deleteCurrentCollection = async () => {
    if (!project || !effectiveCollectionId) return;
    const name = collections.find((c) => c.id === effectiveCollectionId)?.name ?? effectiveCollectionId;
    const res = await window.atp.deleteCollection(project, effectiveCollectionId);
    if (!res.ok) {
      showToast(res.error ?? "删除集合失败");
      return;
    }
    setPendingCollectionDelete(false);
    setActiveRequestId(null);
    setDraft(defaultDraft());
    setResponse(null);
    const list = await window.atp.listCollections(project);
    setCollections(list);
    const nextId = list[0]?.id ?? "default";
    setCollectionId(nextId);
    showToast(
      res.recreatedDefault
        ? `已删除集合「${name}」，已自动创建空白的「默认模块」`
        : `已删除集合「${name}」`,
    );
    await loadCollections();
    if (res.recreatedDefault) {
      setCollectionId("default");
    }
  };

  const deleteActive = () => {
    if (!activeRequestId) {
      showToast("请先在左侧选中要删除的请求");
      return;
    }
    setPendingRequestDelete(activeRequestId);
  };

  const responseBodyDisplay = useMemo(() => {
    if (!response) return "";
    if (respView !== "body") return "";
    const emptyHint = httpEmptyBodyHint(response.status, response.bodySize);
    if (!response.bodyText && emptyHint) return emptyHint;
    const ct = response.headers["content-type"] ?? response.headers["Content-Type"] ?? "";
    if (/json/i.test(ct) && response.bodyText) return formatJsonBody(response.bodyText);
    return response.bodyText;
  }, [response, respView]);

  const headerCount = draft.headers.filter((h) => h.enabled && h.key.trim()).length;

  const sendUrlPreview = useMemo(() => {
    if (protocol === "ws") {
      try {
        return resolveWorkbenchWsConnect(draft, variables).url;
      } catch {
        return null;
      }
    }
    try {
      return resolveWorkbenchPayload(draft, variables).url;
    } catch {
      return null;
    }
  }, [draft, variables, protocol]);

  const requestCount = collection?.requests.length ?? 0;
  const sidebarEmpty =
    !collection?.requests.length &&
    !(collection?.folders ?? []).some((f) => f.trim());
  const suggestProjectBaseUrl = (): string | undefined => {
    let raw = draft.url.trim() || buildUrl(draft.url, draft.query).trim();
    if (!raw && sendUrlPreview) raw = sendUrlPreview;
    const origin = raw ? originFromRequestUrl(raw) : null;
    return origin ?? undefined;
  };

  const openCreateProject = () => onRequestCreateProject?.(suggestProjectBaseUrl());

  return (
    <div className="workbench">
      <header className="workbench-topbar">
        <h2 className="page-head workbench-title">API 工作台</h2>
        <div className="workbench-topbar-strip">
          <span className="workbench-topbar-label">工作区</span>
          <select
            className="workbench-topbar-control"
            value={project || ""}
            disabled={!projects.length}
            onChange={(e) => onProject(e.target.value)}
            aria-label="项目"
          >
            {!projects.length ? (
              <option value="">暂无项目</option>
            ) : (
              projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </select>
          <select
            className="workbench-topbar-control workbench-topbar-control--env"
            value={envName}
            disabled={!project}
            onChange={(e) => setEnvName(e.target.value)}
            aria-label="环境"
          >
            {environments.map((e) => (
              <option key={e} value={e}>
                env:{e}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="nav-btn"
            disabled={!project}
            title={project ? "新建环境" : "请先选择项目"}
            onClick={() => setCreateEnvOpen(true)}
          >
            + 环境
          </button>
          <button type="button" className="nav-btn" disabled={!project} onClick={() => setEnvDialogOpen(true)}>
            变量
          </button>
          {!projects.length && onRequestCreateProject ? (
            <button type="button" className="nav-btn nav-btn--ghost" onClick={openCreateProject}>
              新建项目
            </button>
          ) : null}
        </div>
      </header>

      <div className="workbench-body loading-host workbench-body--loadable">
        <LoadingOverlay
          show={workbenchLoading || variablesLoading}
          label={workbenchLoading ? "加载集合…" : "加载环境变量…"}
        />
        <aside className="workbench-collections">
          <div className="workbench-sidebar-head">
            <div className="workbench-sidebar-block">
              <span className="workbench-sidebar-kicker">集合模块</span>
              <div className="workbench-sidebar-module-row">
                <select
                  value={project ? effectiveCollectionId : ""}
                  onChange={(e) => {
                    setCollectionId(e.target.value);
                    setActiveRequestId(null);
                    setDraft(defaultDraft());
                  }}
                  aria-label="集合"
                  className="workbench-sidebar-select"
                  disabled={!project || !collections.length}
                >
                  {!collections.length ? (
                    <option value="">暂无模块</option>
                  ) : (
                    collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.requestCount}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  className="workbench-icon-btn workbench-icon-btn--muted"
                  disabled={!project || !effectiveCollectionId}
                  title="删除当前集合模块"
                  aria-label="删除当前集合模块"
                  onClick={() => setPendingCollectionDelete(true)}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="workbench-sidebar-divider" aria-hidden />
            <div className="workbench-sidebar-toolbar">
              <span className="workbench-sidebar-toolbar-label">请求</span>
              {requestCount > 0 ? (
                <span className="workbench-sidebar-count">{requestCount}</span>
              ) : null}
              <span className="workbench-sidebar-toolbar-spacer" />
              <button
                type="button"
                className="workbench-icon-btn"
                onClick={() => setImportCurlOpen(true)}
                title="导入 cURL"
                aria-label="导入 cURL"
              >
                ⎘
              </button>
              <button
                type="button"
                className="workbench-icon-btn workbench-icon-btn--accent"
                onClick={() => newRequest()}
                title="新建请求"
                aria-label="新建请求"
              >
                +
              </button>
            </div>
          </div>
          <div className="workbench-tree">
            {sidebarEmpty && (
              <div className="workbench-sidebar-empty">
                <p>暂无保存的请求</p>
                <button type="button" className="nav-btn" onClick={() => setImportCurlOpen(true)}>
                  导入 cURL
                </button>
              </div>
            )}
            {folderGroups.map((group) => (
              <div key={group.folder || "__root__"} className="workbench-folder">
                {group.folder ? (
                  <div className="workbench-folder-name">
                    <span className="workbench-folder-label" title={group.folder}>
                      {group.folder}
                    </span>
                    <button
                      type="button"
                      className="workbench-folder-del"
                      title="删除该分组"
                      onClick={() => setPendingFolderDelete(group.folder)}
                    >
                      ×
                    </button>
                  </div>
                ) : null}
                <ul className="workbench-req-list">
                  {group.requests.map((r) => (
                    <li key={r.id} className="workbench-req-row">
                      <button
                        type="button"
                        className={`workbench-req-item${activeRequestId === r.id ? " active" : ""}`}
                        onClick={() => openRequest(r.id)}
                      >
                        <span className={`method-tag method-${r.method.toLowerCase()}`}>{r.method}</span>
                        <span className="workbench-req-name">{r.name}</span>
                      </button>
                      <button
                        type="button"
                        className="workbench-req-del"
                        title={`删除「${r.name}」`}
                        aria-label={`删除请求 ${r.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingRequestDelete(r.id);
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </aside>

        <section className="workbench-editor">
          <div className="workbench-editor-zone workbench-editor-zone--url">
            <div className="workbench-send-row">
              <div className="workbench-method-group" aria-label="协议与方法">
                <select
                  className="workbench-method workbench-protocol"
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value as Protocol)}
                  aria-label="协议"
                >
                  <option value="http">HTTP</option>
                  <option value="ws">WS</option>
                </select>
                {protocol === "http" ? (
                  <select
                    className="workbench-method workbench-method--verb"
                    value={draft.method}
                    onChange={(e) => setDraft((d) => ({ ...d, method: e.target.value }))}
                    aria-label="HTTP 方法"
                  >
                    {HTTP_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="workbench-method workbench-method-ws" aria-hidden>
                    WS
                  </span>
                )}
              </div>
              <input
                className="text-input workbench-url-input"
                value={draft.url}
                placeholder={protocol === "ws" ? "wss://host/path" : "https://host/path 或 {{base_url}}/path"}
                title={sendUrlPreview ?? undefined}
                onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
              />
            {protocol === "http" ? (
              <button type="button" className="primary workbench-send" disabled={sending} onClick={() => void onSend()}>
                {sending ? "发送中…" : "Send"}
              </button>
            ) : (
              <>
                {!wsOpen ? (
                  <button
                    type="button"
                    className="primary workbench-send"
                    disabled={wsConnecting}
                    onClick={() => void onWsConnect()}
                  >
                    {wsConnecting ? "连接中…" : "Connect"}
                  </button>
                ) : (
                  <button type="button" className="nav-btn workbench-send" onClick={() => onWsDisconnect()}>
                    Disconnect
                  </button>
                )}
                <button
                  type="button"
                  className="primary workbench-send"
                  disabled={!wsOpen}
                  onClick={() => void onWsSend()}
                >
                  Send
                </button>
              </>
            )}
            </div>
          </div>

          <div className="workbench-editor-zone workbench-editor-zone--meta">
            <div className="workbench-editor-meta-row">
              <label className="workbench-inline-field">
                <span>名称</span>
                <input
                  className="text-input"
                  value={draft.name ?? ""}
                  placeholder={activeRequestId ? "请求显示名" : "未命名"}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </label>
              <label className="workbench-inline-field workbench-inline-field--folder">
                <span>分组</span>
                <input
                  className="text-input"
                  value={draft.folder ?? ""}
                  placeholder="可选"
                  onChange={(e) => setDraft((d) => ({ ...d, folder: e.target.value }))}
                />
              </label>
              <div className="workbench-editor-actions">
                <button type="button" className="nav-btn nav-btn--compact" onClick={() => setImportCurlOpen(true)}>
                  导入 cURL
                </button>
                <button type="button" className="nav-btn nav-btn--compact" onClick={() => void saveCurrent()}>
                  保存到集合
                </button>
                <button type="button" className="nav-btn nav-btn--compact" onClick={() => setSaveCaseOpen(true)}>
                  保存为用例
                </button>
                {activeRequestId ? (
                  <button type="button" className="nav-btn nav-btn--compact nav-btn--ghost" onClick={() => deleteActive()}>
                    删除
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div
            className={`workbench-editor-zone workbench-editor-zone--request${reqTab === "perf" ? " workbench-editor-zone--request-full" : ""}`}
          >
          <div className="workbench-req-tabs">
            {(
              [
                ["params", "Params"],
                ["headers", `Headers (${headerCount})`],
                ["body", protocol === "ws" ? "Message" : "Body"],
                ...(protocol === "http" ? ([["perf", "性能"]] as const) : []),
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`workbench-tab${reqTab === id ? " active" : ""}`}
                onClick={() => setReqTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="workbench-editor-pane">
          {reqTab === "params" && (
            <KvTable
              rows={draft.query}
              onChange={updateQueryRow}
              onAdd={() => setDraft((d) => ({ ...d, query: [...d.query, emptyRow()] }))}
            />
          )}
          {reqTab === "headers" && (
            <KvTable
              rows={draft.headers}
              onChange={updateHeaderRow}
              onAdd={() => setDraft((d) => ({ ...d, headers: [...d.headers, emptyRow()] }))}
            />
          )}
          {reqTab === "perf" && (
            <PerfPanel
              draft={draft}
              project={project}
              variables={variables}
              disabled={sending}
              onToast={showToast}
            />
          )}

          {reqTab === "body" && (
            <div className="workbench-body-pane">
              {protocol === "http" && (
                <>
                  <label className="check-label">
                    <input
                      type="radio"
                      checked={draft.bodyMode === "none"}
                      onChange={() => setDraft((d) => ({ ...d, bodyMode: "none" }))}
                    />
                    none
                  </label>
                  <label className="check-label">
                    <input
                      type="radio"
                      checked={draft.bodyMode === "raw"}
                      onChange={() => setDraft((d) => normalizeRawBodyDraft({ ...d, bodyMode: "raw" }))}
                    />
                    raw
                  </label>
                </>
              )}
              {(protocol === "ws" || draft.bodyMode === "raw") && (
                <>
                  {protocol === "http" && (
                    <select
                      className="text-input workbench-content-type"
                      value={draft.bodyContentType ?? "application/json"}
                      onChange={(e) => setDraft((d) => ({ ...d, bodyContentType: e.target.value }))}
                    >
                      <option value="application/json">application/json</option>
                      <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
                      <option value="text/plain">text/plain</option>
                    </select>
                  )}
                  <textarea
                    className="workbench-body-textarea"
                    value={draft.body}
                    spellCheck={false}
                    placeholder={protocol === "ws" ? "连接后点击 Send 发送此消息…" : undefined}
                    onChange={(e) =>
                      setDraft((d) =>
                        protocol === "ws" ? { ...d, bodyMode: "raw", body: e.target.value } : { ...d, body: e.target.value },
                      )
                    }
                  />
                </>
              )}
            </div>
          )}
          </div>
          </div>

          {reqTab !== "perf" && (
          <div className="workbench-editor-zone workbench-editor-zone--response workbench-response">
            <div className="workbench-response-head">
              <span className="workbench-response-title">{protocol === "ws" ? "Messages" : "Response"}</span>
              {protocol === "http" && response && (
                <span
                  className={`workbench-status ${httpStatusTone(response.status, response.ok)}`}
                >
                  {response.status || "—"} {response.statusText} · {response.durationMs} ms · {response.bodySize} B
                </span>
              )}
              {protocol === "ws" && (
                <span className={`workbench-status ${wsOpen ? "ok" : wsConnecting ? "" : "err"}`}>
                  {wsOpen ? "OPEN" : wsConnecting ? "CONNECTING…" : "CLOSED"}
                </span>
              )}
              {protocol === "http" && (
                <>
                  <button
                    type="button"
                    className={`workbench-tab small${respView === "body" ? " active" : ""}`}
                    onClick={() => setRespView("body")}
                  >
                    Body
                  </button>
                  <button
                    type="button"
                    className={`workbench-tab small${respView === "headers" ? " active" : ""}`}
                    onClick={() => setRespView("headers")}
                  >
                    Headers
                  </button>
                </>
              )}
              {protocol === "ws" && wsLog.length > 0 && (
                <button type="button" className="workbench-tab small" onClick={() => setWsLog([])}>
                  清空
                </button>
              )}
            </div>
            {protocol === "ws" ? (
              wsLog.length ? (
                <pre className="workbench-response-pre workbench-ws-log">
                  {wsLog.map((line, i) => (
                    <span key={i} className={`ws-log-line ws-log-${line.kind}`}>
                      [{line.at}] {line.kind === "in" ? "←" : line.kind === "out" ? "→" : "·"} {line.text}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              ) : (
                <div className="workbench-response-placeholder">
                  <span className="workbench-response-placeholder-hint">Connect 后消息将显示在此处</span>
                </div>
              )
            ) : !response ? (
              <div className="workbench-response-placeholder">
                <span className="workbench-response-placeholder-hint">填写 URL 后点击 Send，响应将显示在此处</span>
              </div>
            ) : respView === "headers" ? (
              <pre className="workbench-response-pre">{JSON.stringify(response.headers, null, 2)}</pre>
            ) : (
              <pre className="workbench-response-pre">{responseBodyDisplay || response.error || "(空响应)"}</pre>
            )}
          </div>
          )}
        </section>
      </div>

      <ImportCurlDialog
        open={importCurlOpen}
        onCancel={() => setImportCurlOpen(false)}
        onImport={(draft, warnings) => {
          setImportCurlOpen(false);
          setDraft(normalizeRawBodyDraft(draft));
          setActiveRequestId(null);
          setResponse(null);
          resetWsSession();
          if (isWsUrl(draft.url)) setProtocol("ws");
          else setProtocol("http");
          showToast(warnings.length ? `已导入 cURL（${warnings.join("；")}）` : "已导入 cURL");
        }}
      />

      <CreateEnvDialog
        open={createEnvOpen}
        copyFrom={envName}
        suggestedBaseUrl={
          variables.base_url?.trim() ||
          suggestProjectBaseUrl() ||
          originFromRequestUrl(draft.url) ||
          undefined
        }
        onCancel={() => setCreateEnvOpen(false)}
        onCreate={(opts) => {
          if (!project) {
            showToast("请先选择项目");
            return;
          }
          void (async () => {
            const res = await window.atp.createProjectEnvironment(project, opts.envName, {
              copyFrom: opts.copyFrom,
              baseUrl: opts.baseUrl,
            });
            if (!res.ok || !res.envName) {
              showToast(res.error ?? "创建环境失败");
              return;
            }
            setCreateEnvOpen(false);
            await refreshEnvironments();
            setEnvName(res.envName);
            showToast(`已创建环境 env:${res.envName}`);
          })();
        }}
      />

      <EnvVariablesDialog
        open={envDialogOpen}
        project={project}
        envName={envName}
        variableNames={collectTemplateVarNames(draft)}
        onCancel={() => setEnvDialogOpen(false)}
        onSaved={() => {
          setEnvDialogOpen(false);
          void window.atp.getProjectVariables(project, envName).then(setVariables);
          showToast("环境变量已保存");
        }}
      />

      <SaveCaseDialog
        open={saveCaseOpen}
        defaultName={draft.name?.trim() || "api-case"}
        yamlPreview={workbenchDraftToCaseYaml(draft, response?.status)}
        onCancel={() => setSaveCaseOpen(false)}
        onConfirm={({ caseName, addToSuite, suiteName }) => {
          void (async () => {
            const yaml = workbenchDraftToCaseYaml(draft, response?.status);
            const exists = await window.atp.projectCaseExists(project, caseName);
            setSaveCaseOpen(false);
            if (exists) {
              setPendingCaseOverwrite({ caseName, addToSuite, suiteName, yaml });
              return;
            }
            const res = await window.atp.saveProjectCase(project, caseName, yaml, {
              addToSuite: addToSuite ? suiteName : undefined,
            });
            if (!res.ok) {
              showToast(res.error ?? "保存失败");
              return;
            }
            showToast(`已保存 ${res.relativePath}`);
            onCaseSaved?.();
          })();
        }}
      />

      <ConfirmDialog
        open={pendingRequestDelete !== null}
        title="删除请求"
        message={
          pendingRequestDelete
            ? `将删除「${
                collection?.requests.find((r) => r.id === pendingRequestDelete)?.name ?? "该请求"
              }」，不可恢复。`
            : ""
        }
        confirmLabel="删除"
        danger
        onCancel={() => setPendingRequestDelete(null)}
        onConfirm={() => {
          if (pendingRequestDelete) void deleteRequestById(pendingRequestDelete);
        }}
      />

      <ConfirmDialog
        open={pendingFolderDelete !== null}
        title="删除分组"
        message={
          pendingFolderDelete
            ? (() => {
                const n =
                  collection?.requests.filter((r) => r.folder === pendingFolderDelete).length ?? 0;
                return n
                  ? `将删除分组「${pendingFolderDelete}」及其中的 ${n} 个请求，不可恢复。`
                  : `将删除空分组「${pendingFolderDelete}」。`;
              })()
            : ""
        }
        confirmLabel="删除"
        danger
        onCancel={() => setPendingFolderDelete(null)}
        onConfirm={() => {
          const name = pendingFolderDelete;
          if (name) void deleteFolder(name);
        }}
      />

      <ConfirmDialog
        open={pendingCollectionDelete}
        title="删除集合"
        message={`将删除集合「${collections.find((c) => c.id === effectiveCollectionId)?.name ?? effectiveCollectionId}」及其全部请求（不可恢复）。${
          collections.length <= 1 ? " 这是当前唯一的集合，删除后将自动创建一个空的「默认模块」。" : ""
        }`}
        confirmLabel="删除"
        danger
        onCancel={() => setPendingCollectionDelete(false)}
        onConfirm={() => void deleteCurrentCollection()}
      />

      <ConfirmDialog
        open={pendingCaseOverwrite !== null}
        title="覆盖用例"
        message={`cases/${pendingCaseOverwrite?.caseName ?? ""}.yaml 已存在，是否覆盖？`}
        confirmLabel="覆盖"
        danger
        onCancel={() => setPendingCaseOverwrite(null)}
        onConfirm={() => {
          const pending = pendingCaseOverwrite;
          setPendingCaseOverwrite(null);
          if (!pending) return;
          void (async () => {
            const res = await window.atp.saveProjectCase(project, pending.caseName, pending.yaml, {
              addToSuite: pending.addToSuite ? pending.suiteName : undefined,
              overwrite: true,
            });
            if (!res.ok) {
              showToast(res.error ?? "覆盖失败");
              return;
            }
            showToast(`已覆盖 ${res.relativePath}`);
            onCaseSaved?.();
          })();
        }}
      />

      {toast && (
        <div className="app-toast" role="status">
          <span className="app-toast-dot" />
          {toast}
        </div>
      )}
    </div>
  );
}

function KvTable({
  rows,
  onChange,
  onAdd,
}: {
  rows: { key: string; value: string; enabled: boolean }[];
  onChange: (index: number, patch: Partial<{ key: string; value: string; enabled: boolean }>) => void;
  onAdd: () => void;
}) {
  return (
    <div className="workbench-kv">
      <table>
        <thead>
          <tr>
            <th style={{ width: 36 }} />
            <th>Key</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(e) => onChange(i, { enabled: e.target.checked })}
                />
              </td>
              <td>
                <input
                  className="text-input workbench-kv-input"
                  value={row.key}
                  onChange={(e) => onChange(i, { key: e.target.value })}
                />
              </td>
              <td>
                <input
                  className="text-input workbench-kv-input"
                  value={row.value}
                  onChange={(e) => onChange(i, { value: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="nav-btn workbench-add-row" onClick={onAdd}>
        + 添加行
      </button>
    </div>
  );
}