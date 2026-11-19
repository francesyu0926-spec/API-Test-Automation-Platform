import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ApiCollectionFile, HttpSendResult, WsEvent, WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import CaseSaveConflictDialog from "./CaseSaveConflictDialog";
import ConfirmDialog from "./ConfirmDialog";
import { workbenchDraftCaseStem, workbenchDraftToCaseYaml } from "./caseYaml";
import ImportCurlDialog from "./ImportCurlDialog";
import { useProjectEnv } from "./ProjectEnvContext";
import AppCustomSelect from "./AppCustomSelect";
import WorkbenchKvTable, { type WorkbenchKvTableHandle } from "./WorkbenchKvTable";
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
  normalizeEditorKvRows,
  formatJsonBody,
  httpEmptyBodyHint,
  httpStatusTone,
  normalizeRawBodyDraft,
  savedRequestToDraft,
} from "./apiWorkbenchModel";
import {
  httpUrlToWsUrl,
  resolvedUrlLooksLikeWs,
  shouldSuggestWsAfterHttp,
} from "./workbenchWsHint";
import { applyImportedCurlAuth, coalesceAuthVariables, unresolvedWorkbenchVars } from "./samplerAuth";
import CaptureCodeBlock from "./CaptureCodeBlock";
import JsonResponseView, { type JsonResponseViewHandle } from "./JsonResponseView";
import { countSelectedRows } from "./jsonVisualSelection";
import { businessLoginHintFromBody, parseResponseJson } from "./parseResponseJson";
import {
  PNG_EXPORT_MAX_ROWS,
  buildExportSheets,
  exportSheetsToPngBase64,
  exportSheetsToXlsxBase64,
  suggestExportBaseName,
} from "./jsonVisualExport";
import { saveBytesWithDialog } from "./saveBytesWithDialog";
import { WorkbenchGroupFolderIcon, WorkbenchSaveCollectionIcon } from "./workbenchMetaIcons";

type Props = {
  project: string;
  projectName?: string;
  externalDraft: WorkbenchDraft | null;
  /** 每次从用例/集合注入时递增，触发灌入（不 remount 工作台） */
  externalInjectGeneration?: number;
  /** 从「项目与用例」集合行打开时定位左侧请求 */
  externalOpenRequestId?: string | null;
  externalOpenCollectionId?: string | null;
  collectionReloadNonce?: number;
  onConsumeExternalDraft: () => void;
  onCaseSaved?: () => void;
  onRequestCreateProject?: (suggestedBaseUrl?: string) => void;
  onSendToLoadTest?: (payload: {
    draft: WorkbenchDraft;
    envName: string;
    variables: Record<string, string>;
  }) => void;
  /** 从负载测试跳入时，发送按钮文案为「应用到压测」 */
  applyToLoadTest?: boolean;
};

type ReqTab = "params" | "headers" | "body";
type Protocol = "http" | "ws";

const HTTP_BODY_CONTENT_TYPES = [
  { value: "application/json", label: "JSON" },
  { value: "application/xml", label: "XML" },
  { value: "text/plain", label: "Text" },
  { value: "text/html", label: "HTML" },
] as const;

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
  projectName,
  externalDraft,
  externalInjectGeneration = 0,
  externalOpenRequestId = null,
  externalOpenCollectionId = null,
  collectionReloadNonce = 0,
  onConsumeExternalDraft,
  onCaseSaved,
  onRequestCreateProject,
  onSendToLoadTest,
  applyToLoadTest,
}: Props) {
  const {
    envName,
    variables,
    variablesLoading,
    refreshEnvironments,
    refreshVariables,
    openEnvVariables,
    openCreateEnv,
  } = useProjectEnv();

  const [collections, setCollections] = useState<Awaited<ReturnType<typeof window.atp.listCollections>>>([]);
  const [collectionId, setCollectionId] = useState(() => externalOpenCollectionId ?? "default");
  const [collection, setCollection] = useState<ApiCollectionFile | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(() => externalOpenRequestId ?? null);
  const [draft, setDraft] = useState<WorkbenchDraft>(() =>
    externalDraft ? normalizeRawBodyDraft(externalDraft) : defaultDraft(),
  );
  const [reqTab, setReqTab] = useState<ReqTab>("params");
  const queryKvRef = useRef<WorkbenchKvTableHandle>(null);
  const headersKvRef = useRef<WorkbenchKvTableHandle>(null);
  const [kvBulkOpen, setKvBulkOpen] = useState(false);

  useEffect(() => {
    setKvBulkOpen(false);
  }, [reqTab]);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<HttpSendResult | null>(null);
  const [respBodyMode, setRespBodyMode] = useState<"raw" | "visual">("visual");
  const [respJsonPretty, setRespJsonPretty] = useState(true);
  const [visualExportBusy, setVisualExportBusy] = useState(false);
  const [visualSelectedCount, setVisualSelectedCount] = useState(0);
  const jsonVisualRef = useRef<JsonResponseViewHandle>(null);
  const [respView, setRespView] = useState<"body" | "headers">("body");
  const [toast, setToast] = useState("");
  const [wsSwitchHint, setWsSwitchHint] = useState(false);
  const [pendingCollectionDelete, setPendingCollectionDelete] = useState(false);
  const [pendingFolderDelete, setPendingFolderDelete] = useState<string | null>(null);
  const [pendingRequestDelete, setPendingRequestDelete] = useState<string | null>(null);
  const [importCurlOpen, setImportCurlOpen] = useState(false);
  const [pendingCaseConflict, setPendingCaseConflict] = useState<{
    projectId: string;
    caseName: string;
    renameDefault: string;
    yaml: string;
  } | null>(null);
  const [protocol, setProtocol] = useState<Protocol>("http");
  const wsConnectionId = useRef(crypto.randomUUID().slice(0, 16));
  const [wsOpen, setWsOpen] = useState(false);
  const [wsConnecting, setWsConnecting] = useState(false);
  const [wsLog, setWsLog] = useState<WsLogLine[]>([]);
  const [workbenchLoading, setWorkbenchLoading] = useState(false);
  const [draftImporting, setDraftImporting] = useState(false);
  const RESPONSE_HEIGHT_KEY = "atp:workbenchResponseH";
  const [responsePaneHeight, setResponsePaneHeight] = useState(() => {
    try {
      const raw = sessionStorage.getItem(RESPONSE_HEIGHT_KEY);
      const n = raw ? Number(raw) : 300;
      return Number.isFinite(n) ? Math.min(720, Math.max(140, n)) : 300;
    } catch {
      return 300;
    }
  });
  const [splitDragging, setSplitDragging] = useState(false);
  const splitDragRef = useRef<{ startY: number; startH: number } | null>(null);
  const responsePaneHeightRef = useRef(responsePaneHeight);
  responsePaneHeightRef.current = responsePaneHeight;
  const sendAfterEnvSaveRef = useRef(false);
  const consumeExternalDraftRef = useRef(onConsumeExternalDraft);
  consumeExternalDraftRef.current = onConsumeExternalDraft;
  const externalDraftGenRef = useRef(0);
  const lastAppliedInjectGenRef = useRef(0);
  const externalOpenRequestIdRef = useRef<string | null>(externalOpenRequestId);
  const externalOpenCollectionIdRef = useRef<string | null>(externalOpenCollectionId);
  const collectionRequestSyncedRef = useRef(false);
  const projectScopeRef = useRef(project);
  projectScopeRef.current = project;

  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 2600);
  };

  const loadCollections = useCallback(async () => {
    const pid = project;
    if (!pid) return;
    const list = await window.atp.listCollections(pid);
    if (projectScopeRef.current !== pid) return;
    setCollections(list);
    if (!list.some((c) => c.id === collectionId) && list.length) {
      setCollectionId(list[0].id);
    }
    if (!list.length) {
      await window.atp.ensureCollection(pid, "default");
      const again = await window.atp.listCollections(pid);
      if (projectScopeRef.current !== pid) return;
      setCollections(again);
    }
  }, [project, collectionId]);

  const effectiveCollectionId = useMemo(() => {
    if (!collections.length) return collectionId || "default";
    return collections.some((c) => c.id === collectionId) ? collectionId : collections[0].id;
  }, [collections, collectionId]);

  const activeCollectionName = useMemo(() => {
    return collections.find((c) => c.id === effectiveCollectionId)?.name ?? effectiveCollectionId;
  }, [collections, effectiveCollectionId]);

  useEffect(() => {
    if (!project || !collections.length) return;
    if (effectiveCollectionId !== collectionId) {
      setCollectionId(effectiveCollectionId);
    }
  }, [project, collections, collectionId, effectiveCollectionId]);

  const loadCollection = useCallback(async () => {
    const pid = project;
    const cid = effectiveCollectionId;
    if (!pid || !cid) return;
    setWorkbenchLoading(true);
    try {
      const doc = await window.atp.getCollection(pid, cid);
      if (projectScopeRef.current !== pid) return;
      if (doc) setCollection(doc);
      else {
        const created = await window.atp.ensureCollection(pid, cid);
        if (projectScopeRef.current !== pid) return;
        setCollection(created);
      }
    } finally {
      if (projectScopeRef.current === pid) setWorkbenchLoading(false);
    }
  }, [project, effectiveCollectionId]);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);


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

  const prevProjectForResetRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevProjectForResetRef.current;
    const isFirstMount = prev === null;
    const projectChanged = prev !== null && prev !== project;
    prevProjectForResetRef.current = project;
    setCollections([]);
    setCollection(null);
    if (projectChanged) {
      setCollectionId("default");
      setActiveRequestId(null);
      setDraft(defaultDraft());
    } else if (isFirstMount) {
      if (externalOpenCollectionId) {
        setCollectionId(externalOpenCollectionId);
      } else if (!externalDraft) {
        setCollectionId("default");
      }
      if (!externalDraft) {
        setActiveRequestId(null);
        setDraft(defaultDraft());
      }
    }
    setResponse(null);
    resetWsSession();
    // externalDraft: 仅首屏挂载时读取，避免 consume 后误清空编辑器
    // eslint-disable-next-line react-hooks/exhaustive-deps -- externalDraft / externalOpenCollectionId on inject only
  }, [project, resetWsSession]);

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
    void loadCollections();
    void loadCollection();
  }, [loadCollection, loadCollections, collectionReloadNonce]);

  const resendAfterEnvSave = useRef<() => void>(() => {});

  const openEnvConfig = useCallback(
    (reason?: string, opts?: { markResendAfterSave?: boolean; sampler?: WorkbenchDraft }) => {
      if (reason) showToast(reason);
      if (opts?.markResendAfterSave) sendAfterEnvSaveRef.current = true;
      openEnvVariables({
        sampler: opts?.sampler ?? draft,
        onSaved: opts?.markResendAfterSave ? () => resendAfterEnvSave.current() : undefined,
      });
    },
    [draft, openEnvVariables],
  );

  const openEnvConfigRef = useRef(openEnvConfig);
  openEnvConfigRef.current = openEnvConfig;

  const fetchProjectVariables = useCallback(async (): Promise<Record<string, string>> => {
    if (!project?.trim()) return coalesceAuthVariables({ ...variables });
    try {
      const raw = await window.atp.getProjectVariables(project, envName);
      return coalesceAuthVariables(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`读取环境变量失败：${msg}`);
      return coalesceAuthVariables({ ...variables });
    }
  }, [project, envName, variables]);

  const ensureEnvReadyForDraft = useCallback(
    (
      target: WorkbenchDraft,
      opts?: { markResendAfterSave?: boolean },
      varsSnapshot?: Record<string, string>,
    ): boolean => {
      const store = varsSnapshot ?? variables;
      const unresolved = unresolvedWorkbenchVars(target, store);
      if (!unresolved.length) return true;
      if (opts?.markResendAfterSave) sendAfterEnvSaveRef.current = true;
      openEnvConfig(`请先配置环境变量：${unresolved.join("、")}`);
      return false;
    },
    [variables, openEnvConfig],
  );

  useEffect(() => {
    if (!externalDraft || externalInjectGeneration < 1) return;
    if (externalInjectGeneration <= lastAppliedInjectGenRef.current) return;
    lastAppliedInjectGenRef.current = externalInjectGeneration;
    const incoming = externalDraft;
    const openRequestId = externalOpenRequestId;
    const openCollectionId = externalOpenCollectionId;
    externalOpenRequestIdRef.current = openRequestId;
    externalOpenCollectionIdRef.current = openCollectionId;
    collectionRequestSyncedRef.current = false;
    if (openCollectionId) setCollectionId(openCollectionId);
    const generation = ++externalDraftGenRef.current;
  const syncDraft = normalizeRawBodyDraft(incoming);
  setDraft(syncDraft);
  setActiveRequestId(openRequestId ?? null);
  setResponse(null);
  resetWsSession();
  if (isWsUrl(syncDraft.url)) setProtocol("ws");
  else setProtocol("http");
  setDraftImporting(true);
    void (async () => {
      try {
        let normalized = syncDraft;
        const { draft: withAuth } = await applyImportedCurlAuth(project, envName, normalized);
        normalized = withAuth;
        let vars: Record<string, string> = {};
        if (project) {
          await refreshVariables();
          vars = await window.atp.getProjectVariables(project, envName);
        }
        if (generation !== externalDraftGenRef.current) return;
        setDraft(normalized);
        const reqId = externalOpenRequestIdRef.current;
        if (reqId) {
          setActiveRequestId(reqId);
        } else {
          setActiveRequestId(null);
        }
        setResponse(null);
        resetWsSession();
        if (isWsUrl(normalized.url)) setProtocol("ws");
        else setProtocol("http");
        const unresolved = unresolvedWorkbenchVars(normalized, vars);
        if (unresolved.length) {
          openEnvConfigRef.current(
            `请在下方填写环境变量：${unresolved.join("、")}（保存后 Send 与用例共用）`,
            { sampler: normalized },
          );
        }
        if (generation === externalDraftGenRef.current) {
          consumeExternalDraftRef.current();
        }
      } catch (err) {
        if (generation === externalDraftGenRef.current) {
          showToast(err instanceof Error ? err.message : "载入请求失败");
          consumeExternalDraftRef.current();
        }
      } finally {
        if (generation === externalDraftGenRef.current) setDraftImporting(false);
      }
    })();
    // 仅在新 externalDraft 注入时运行；勿依赖 variables/openEnvConfig，避免保存环境后重复灌入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    externalDraft,
    externalInjectGeneration,
    externalOpenRequestId,
    externalOpenCollectionId,
    project,
    envName,
    resetWsSession,
    refreshVariables,
  ]);

  useEffect(() => {
    const reqId = externalOpenRequestIdRef.current;
    if (!reqId || !collection || collectionRequestSyncedRef.current) return;
    const cid = externalOpenCollectionIdRef.current;
    if (cid && collection.id !== cid) return;
    const req = collection.requests.find((r) => r.id === reqId);
    if (!req) return;
    collectionRequestSyncedRef.current = true;
    setActiveRequestId(reqId);
    const nextDraft = savedRequestToDraft(req);
    setDraft(nextDraft);
    setResponse(null);
    resetWsSession();
    if (req.method === "WS" || isWsUrl(nextDraft.url)) setProtocol("ws");
    else setProtocol("http");
  }, [collection, resetWsSession]);

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

  const removeQueryRow = (index: number) => {
    setDraft((d) => {
      const query = d.query.filter((_, i) => i !== index);
      return { ...d, query: query.length ? query : [emptyRow()] };
    });
  };

  const removeHeaderRow = (index: number) => {
    setDraft((d) => {
      const headers = d.headers.filter((_, i) => i !== index);
      return { ...d, headers: headers.length ? headers : [emptyRow()] };
    });
  };

  const replaceQueryRows = (query: WorkbenchDraft["query"]) => {
    setDraft((d) => ({ ...d, query: normalizeEditorKvRows(query) }));
  };

  const replaceHeaderRows = (headers: WorkbenchDraft["headers"]) => {
    setDraft((d) => ({ ...d, headers: normalizeEditorKvRows(headers) }));
  };

  const reorderQueryRow = (from: number, to: number) => {
    setDraft((d) => {
      const query = [...d.query];
      const [item] = query.splice(from, 1);
      query.splice(to, 0, item);
      return { ...d, query };
    });
  };

  const reorderHeaderRow = (from: number, to: number) => {
    setDraft((d) => {
      const headers = [...d.headers];
      const [item] = headers.splice(from, 1);
      headers.splice(to, 0, item);
      return { ...d, headers };
    });
  };

  const onWsConnect = async () => {
    const wsVars = await fetchProjectVariables();
    if (!ensureEnvReadyForDraft(draft, undefined, wsVars)) return;
    let resolvedUrl = "";
    try {
      resolvedUrl = resolveWorkbenchWsConnect(draft, wsVars).url;
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
      const { url: resolvedUrl, headers } = resolveWorkbenchWsConnect(draft, wsVars);
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
        if ((res.error ?? "").includes("未定义变量")) openEnvVariables({ sampler: draft });
      }
    } catch (err) {
      setWsConnecting(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("未定义变量")) openEnvVariables({ sampler: draft });
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
    const wsVars = await fetchProjectVariables();
    if (!ensureEnvReadyForDraft(draft, { markResendAfterSave: true }, wsVars)) return;
    if (!wsOpen) {
      showToast("请先连接 WebSocket");
      return;
    }
    let data = draft.body || "";
    if (data) {
      try {
        data = substituteVars(data, wsVars);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("未定义变量")) openEnvVariables({ sampler: draft });
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

  const onSend = async (sendOpts?: { varsOverride?: Record<string, string>; skipEnvGate?: boolean }) => {
    if (protocol === "ws") {
      await onWsSend();
      return;
    }
    const activeVars = sendOpts?.varsOverride ?? (await fetchProjectVariables());
    if (!buildUrl(draft.url, draft.query).trim() && !draft.url.trim()) {
      showToast("请填写 URL");
      return;
    }
    if (
      !sendOpts?.skipEnvGate &&
      !ensureEnvReadyForDraft(draft, { markResendAfterSave: true }, activeVars)
    ) {
      return;
    }
    setSending(true);
    setResponse(null);
    setWsSwitchHint(false);
    if (resolvedUrlLooksLikeWs(draft)) {
      showToast("URL 像 WebSocket 行情通道；若 HTTP 返回 404，请切到 WS 后点 Connect");
    }
    try {
      const payload = resolveWorkbenchPayload(draft, activeVars);
      const res = await window.atp.sendHttpRequest(payload);
      setResponse(res);
      if (shouldSuggestWsAfterHttp(res.status, payload.url, payload.method)) {
        setWsSwitchHint(true);
      }
      const loginHint = businessLoginHintFromBody(res.bodyText);
      if (loginHint) {
        openEnvConfig(loginHint, { markResendAfterSave: true });
      } else if (res.error) showToast(res.error);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("未定义变量")) openEnvVariables({ sampler: draft });
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

  resendAfterEnvSave.current = () => {
    void window.atp.getProjectVariables(project, envName).then((vars) => {
      showToast("环境变量已保存");
      if (!sendAfterEnvSaveRef.current) return;
      if (unresolvedWorkbenchVars(draft, vars).length) {
        showToast("仍有未填写的变量，请补全后再次 Send");
        sendAfterEnvSaveRef.current = true;
        openEnvVariables({ sampler: draft, onSaved: () => resendAfterEnvSave.current() });
        return;
      }
      sendAfterEnvSaveRef.current = false;
      void onSend({ varsOverride: vars, skipEnvGate: true });
    });
  };

  const CASE_SUITE_DEFAULT = "smoke";

  const suggestAvailableCaseName = async (projectId: string, base: string): Promise<string> => {
    if (!(await window.atp.projectCaseExists(projectId, base))) return base;
    for (let n = 2; n < 500; n++) {
      const candidate = `${base}-${n}`;
      if (!(await window.atp.projectCaseExists(projectId, candidate))) return candidate;
    }
    return `${base}-${Date.now()}`;
  };

  const writeProjectCase = async (
    projectId: string,
    caseName: string,
    yaml: string,
    overwrite?: boolean,
  ): Promise<{ ok: boolean; error?: string; savedName?: string }> => {
    const res = await window.atp.saveProjectCase(projectId, caseName, yaml, {
      addToSuite: CASE_SUITE_DEFAULT,
      overwrite,
    });
    if (!res.ok) return { ok: false, error: res.error ?? "保存用例失败" };
    return { ok: true, savedName: res.caseName ?? caseName };
  };

  const syncCaseAfterCollectionSave = async (projectId: string): Promise<
    | { kind: "saved"; name: string }
    | { kind: "conflict"; caseName: string; renameDefault: string; yaml: string }
    | { kind: "skipped" }
    | { kind: "error"; message: string }
  > => {
    if (protocol === "ws") return { kind: "skipped" };
    const normalized = normalizeRawBodyDraft({
      ...draft,
      name: draft.name || "未命名请求",
      method: draft.method,
    });
    const stem = workbenchDraftCaseStem(normalized);
    const yaml = workbenchDraftToCaseYaml(normalized, response?.status);
    const exists = await window.atp.projectCaseExists(projectId, stem);
    if (exists) {
      const renameDefault = await suggestAvailableCaseName(projectId, stem);
      setPendingCaseConflict({ projectId, caseName: stem, renameDefault, yaml });
      return { kind: "conflict", caseName: stem, renameDefault, yaml };
    }
    const res = await writeProjectCase(projectId, stem, yaml);
    if (!res.ok) return { kind: "error", message: res.error ?? "保存用例失败" };
    onCaseSaved?.();
    return { kind: "saved", name: res.savedName ?? stem };
  };

  const saveCurrent = async () => {
    if (!project) {
      showToast("请先在左侧工作区选择项目");
      openCreateProject();
      return;
    }
    const url = draft.url.trim() || buildUrl(draft.url, draft.query).trim();
    if (!url) {
      showToast("请填写 URL 后再保存");
      return;
    }
    const targetId = effectiveCollectionId || collections[0]?.id || "default";
    const targetName = collections.find((c) => c.id === targetId)?.name ?? targetId;
    let col: ApiCollectionFile;
    try {
      col =
        (await window.atp.getCollection(project, targetId)) ??
        (await window.atp.ensureCollection(project, targetId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg || "无法加载目标集合");
      return;
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
    const collectionMsg = `已保存到集合「${targetName}」`;
    const caseOutcome = await syncCaseAfterCollectionSave(project);
    if (caseOutcome.kind === "saved") {
      showToast(`${collectionMsg} · 已同步用例 cases/${caseOutcome.name}.yaml（已加入套件 ${CASE_SUITE_DEFAULT}）`);
    } else if (caseOutcome.kind === "conflict") {
      showToast(`${collectionMsg} · 用例重名，请选择覆盖、另存为或取消`);
    } else if (caseOutcome.kind === "error") {
      showToast(`${collectionMsg} · 用例未写入：${caseOutcome.message}`);
    } else {
      showToast(collectionMsg);
    }
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

  const responseImageSrc = useMemo(() => {
    if (!response || respView !== "body") return null;
    if (!response.bodyBase64 || !response.bodyMime) return null;
    return `data:${response.bodyMime};base64,${response.bodyBase64}`;
  }, [response, respView]);
  const responseContentType = useMemo(() => {
    if (!response) return "";
    return response.headers["content-type"] ?? response.headers["Content-Type"] ?? "";
  }, [response]);

  const responseJson = useMemo(() => {
    if (!response?.bodyText) return null;
    return parseResponseJson(response.bodyText, responseContentType);
  }, [response, responseContentType]);

  const responseBodyDisplay = useMemo(() => {
    if (!response) return "";
    if (respView !== "body") return "";
    if (responseImageSrc) return response.bodyText;
    const emptyHint = httpEmptyBodyHint(response.status, response.bodySize);
    if (!response.bodyText && emptyHint) return emptyHint;
    if (/json/i.test(responseContentType) && response.bodyText) return formatJsonBody(response.bodyText);
    if (responseJson) return formatJsonBody(response.bodyText);
    return response.bodyText;
  }, [response, respView, responseImageSrc, responseContentType, responseJson]);

  const responseRawCopyPayload = useMemo(() => {
    if (!responseBodyDisplay) return "";
    if (responseJson == null) return responseBodyDisplay;
    if (respJsonPretty) {
      try {
        return JSON.stringify(JSON.parse(responseBodyDisplay), null, 2);
      } catch {
        return responseBodyDisplay;
      }
    }
    try {
      return JSON.stringify(JSON.parse(responseBodyDisplay));
    } catch {
      return responseBodyDisplay;
    }
  }, [responseBodyDisplay, responseJson, respJsonPretty]);

  const copyResponseBody = useCallback(async () => {
    const text = responseRawCopyPayload;
    if (!text) return;
    try {
      await window.atp.copyText(text);
      showToast("已复制响应体");
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        showToast("已复制响应体");
      } catch {
        /* ignore */
      }
    }
  }, [responseRawCopyPayload]);

  const exportVisualTable = useCallback(
    async (format: "xlsx" | "png", xlsxScope: "all" | "selected" = "all") => {
      if (!responseJson || visualExportBusy) return;
      if (format === "xlsx" && xlsxScope === "selected" && visualSelectedCount === 0) {
        showToast("请先在可视化表格中勾选要导出的行（表头可全选含未显示行）");
        return;
      }
      if (format === "png") {
        if (visualSelectedCount === 0) {
          showToast("PNG 仅导出勾选行：请先在可视化表格中勾选（最多 20 条）");
          return;
        }
        if (visualSelectedCount > PNG_EXPORT_MAX_ROWS) {
          showToast(`PNG 最多 ${PNG_EXPORT_MAX_ROWS} 条记录，当前已选 ${visualSelectedCount} 条，请减少勾选或使用 XLSX·所选`);
          return;
        }
      }
      setVisualExportBusy(true);
      try {
        const selection = jsonVisualRef.current?.getSelection() ?? {};
        const exportMode =
          format === "png" ? "selected" : xlsxScope === "selected" ? "selected" : "all";
        const sheets = buildExportSheets(responseJson, {
          mode: exportMode,
          selection,
        });
        if (!sheets.length) {
          showToast(
            exportMode === "selected" ? "所选行无法生成工作表，请检查勾选" : "无可导出数据",
          );
          return;
        }
        const url = buildUrl(draft.url, draft.query);
        const base = suggestExportBaseName(url || "response");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const scopeSuffix = exportMode === "selected" ? "-selected" : "";
        if (format === "xlsx") {
          const res = await saveBytesWithDialog({
            defaultPath: `${base}-${stamp}${scopeSuffix}.xlsx`,
            base64: exportSheetsToXlsxBase64(sheets),
            filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
          });
          if (res.ok && res.filePath) {
            const label = xlsxScope === "selected" ? `所选 ${visualSelectedCount} 行` : "全量数据";
            showToast(
              res.error?.includes("主进程") ? res.error : `已导出 XLSX（${label}）：${res.filePath}`,
            );
          } else if (!res.cancelled && res.error) showToast(`导出失败：${res.error}`);
        } else {
          const { base64, truncated } = exportSheetsToPngBase64(sheets);
          const res = await saveBytesWithDialog({
            defaultPath: `${base}-${stamp}${scopeSuffix}.png`,
            base64,
            filters: [{ name: "PNG 图片", extensions: ["png"] }],
          });
          if (res.ok && res.filePath) {
            const label = `所选 ${visualSelectedCount} 条`;
            const tail = truncated ? "（部分工作表在图内被截断）" : "";
            showToast(
              res.error?.includes("主进程")
                ? res.error
                : `已导出 PNG（${label}）${tail}：${res.filePath}`,
            );
          } else if (!res.cancelled && res.error) showToast(`导出失败：${res.error}`);
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e));
      } finally {
        setVisualExportBusy(false);
      }
    },
    [responseJson, visualExportBusy, visualSelectedCount, draft.url, draft.query],
  );

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

  const onResponseSplitMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    splitDragRef.current = { startY: e.clientY, startH: responsePaneHeightRef.current };
    setSplitDragging(true);
    const onMove = (ev: MouseEvent) => {
      const drag = splitDragRef.current;
      if (!drag) return;
      const delta = ev.clientY - drag.startY;
      const next = Math.min(720, Math.max(140, drag.startH + delta));
      setResponsePaneHeight(next);
    };
    const onUp = () => {
      splitDragRef.current = null;
      setSplitDragging(false);
      try {
        sessionStorage.setItem(RESPONSE_HEIGHT_KEY, String(responsePaneHeightRef.current));
      } catch {
        /* ignore */
      }
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onResponseSplitKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const step = e.shiftKey ? 48 : 16;
    setResponsePaneHeight((h) => {
      const next = e.key === "ArrowUp" ? h - step : h + step;
      return Math.min(720, Math.max(140, next));
    });
  };

  useEffect(() => {
    try {
      sessionStorage.setItem(RESPONSE_HEIGHT_KEY, String(responsePaneHeight));
    } catch {
      /* ignore */
    }
  }, [responsePaneHeight]);

  const kvRowCount =
    reqTab === "params" ? draft.query.length : reqTab === "headers" ? draft.headers.length : 0;
  const requestPaneCompact =
    (reqTab === "body" && protocol === "http" && draft.bodyMode === "none") ||
    ((reqTab === "params" || reqTab === "headers") && !kvBulkOpen && kvRowCount <= 4);

  const bodyContentTypeOptions = useMemo(() => {
    const base = HTTP_BODY_CONTENT_TYPES.map((o) => ({ value: o.value, label: o.label }));
    const cur = draft.bodyContentType;
    if (cur && !base.some((o) => o.value === cur)) {
      return [...base, { value: cur, label: cur }];
    }
    return base;
  }, [draft.bodyContentType]);

  const switchToWebSocketMode = () => {
    setProtocol("ws");
    setDraft((d) => ({
      ...d,
      url: httpUrlToWsUrl(d.url),
      bodyMode: "raw",
    }));
    setResponse(null);
    setWsSwitchHint(false);
    resetWsSession();
    setReqTab("body");
    showToast("已切换为 WebSocket，请点击 Connect");
  };

  return (
    <div className="workbench">
      <div className="workbench-body loading-host workbench-body--loadable">
        <LoadingOverlay
          show={workbenchLoading || variablesLoading || draftImporting}
          label={draftImporting ? "同步环境变量…" : workbenchLoading ? "加载集合…" : "加载环境变量…"}
        />
        <aside className="workbench-collections">
          <div className="workbench-sidebar-head">
            <div className="workbench-sidebar-block">
              <span className="workbench-sidebar-kicker">集合模块</span>
              <div className="workbench-sidebar-module-row">
                <AppCustomSelect
                  value={project ? effectiveCollectionId : ""}
                  className="workbench-sidebar-select"
                  ariaLabel="集合"
                  disabled={!project || !collections.length}
                  placeholder="暂无模块"
                  options={
                    collections.length
                      ? collections.map((c) => ({
                          value: c.id,
                          label: `${c.name} · ${c.requestCount}`,
                        }))
                      : [{ value: "", label: "暂无模块" }]
                  }
                  onChange={(nextId) => {
                    setCollectionId(nextId);
                    setActiveRequestId(null);
                    setDraft(defaultDraft());
                  }}
                />
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
                        <span
                          className={`method-tag method-${(r.method || "GET").toLowerCase()}`}
                        >
                          {r.method || "GET"}
                        </span>
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
              <div
                className={`workbench-url-unified${protocol === "ws" ? " workbench-url-unified--ws" : ""}`}
                aria-label={protocol === "ws" ? "WebSocket 地址" : "请求地址"}
              >
                <div className="workbench-method-group" aria-label="协议与方法">
                  <AppCustomSelect
                    variant="method"
                    className="workbench-protocol"
                    triggerClassName="workbench-protocol"
                    value={protocol}
                    ariaLabel="协议"
                    options={[
                      { value: "http", label: "HTTP" },
                      { value: "ws", label: "WS" },
                    ]}
                    onChange={(v) => setProtocol(v as Protocol)}
                  />
                  {protocol === "http" ? (
                    <AppCustomSelect
                      variant="method"
                      className="workbench-method--verb"
                      triggerClassName="workbench-method--verb"
                      value={draft.method}
                      ariaLabel="HTTP 方法"
                      options={HTTP_METHODS.map((m) => ({ value: m, label: m }))}
                      onChange={(method) => setDraft((d) => ({ ...d, method }))}
                    />
                  ) : null}
                </div>
                <input
                  className="text-input workbench-url-input workbench-url-input--unified"
                  value={draft.url}
                  placeholder={
                    protocol === "ws"
                      ? "wss://echo.websocket.events"
                      : "https://host/path 或 {{base_url}}/path"
                  }
                  title={sendUrlPreview ?? undefined}
                  onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
                />
                {protocol === "ws" ? (
                  <span
                    className={`workbench-ws-status-dot${
                      wsOpen
                        ? " workbench-ws-status-dot--open"
                        : wsConnecting
                          ? " workbench-ws-status-dot--connecting"
                          : " workbench-ws-status-dot--closed"
                    }`}
                    title={
                      wsOpen ? "已连接" : wsConnecting ? "连接中" : "未连接"
                    }
                    aria-label={
                      wsOpen ? "已连接" : wsConnecting ? "连接中" : "未连接"
                    }
                  />
                ) : null}
              </div>
              {protocol === "http" ? (
                <button
                  type="button"
                  className="primary workbench-send"
                  disabled={sending || draftImporting}
                  onClick={() => void onSend()}
                >
                  {sending ? "发送中…" : "Send"}
                </button>
              ) : wsOpen ? (
                <>
                  <button
                    type="button"
                    className="workbench-send workbench-ws-disconnect"
                    onClick={() => onWsDisconnect()}
                  >
                    Disconnect
                  </button>
                  <button
                    type="button"
                    className="primary workbench-send"
                    onClick={() => void onWsSend()}
                  >
                    Send
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="primary workbench-send"
                  disabled={wsConnecting}
                  onClick={() => void onWsConnect()}
                >
                  {wsConnecting ? "连接中…" : "Connect"}
                </button>
              )}
            </div>
          </div>

          <div className="workbench-editor-zone workbench-editor-zone--meta">
            <div className="workbench-meta-left">
              <input
                className="text-input workbench-name-input"
                value={draft.name ?? ""}
                placeholder="请输入请求名称"
                aria-label="请求名称"
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
              <label className="workbench-meta-ghost-field" title="请求分组（文件夹）">
                <span className="workbench-meta-pick-icon" aria-hidden>
                  <WorkbenchGroupFolderIcon />
                </span>
                <input
                  className="workbench-meta-ghost-input"
                  value={draft.folder ?? ""}
                  placeholder="未分组"
                  aria-label="分组"
                  onChange={(e) => setDraft((d) => ({ ...d, folder: e.target.value }))}
                />
              </label>
            </div>
            <div className="workbench-meta-actions workbench-meta-actions--compact" role="toolbar" aria-label="请求操作">
              <button
                type="button"
                className="nav-btn nav-btn--compact nav-btn--accent workbench-meta-action-btn"
                title="保存到集合并同步 YAML 用例"
                onClick={() => void saveCurrent()}
              >
                保存
              </button>
              {onSendToLoadTest && protocol === "http" ? (
                <button
                  type="button"
                  className="nav-btn nav-btn--compact nav-btn--ghost workbench-meta-action-btn"
                  title="将当前请求带到负载测试页"
                  onClick={() =>
                    onSendToLoadTest({
                      draft: normalizeRawBodyDraft(draft),
                      envName,
                      variables: { ...variables },
                    })
                  }
                >
                  {applyToLoadTest ? "应用到压测" : "发送到压测"}
                </button>
              ) : null}
              <details className="capture-detail-more workbench-meta-more">
                <summary className="capture-detail-more-summary workbench-meta-more-summary" aria-label="更多操作">
                  ⋯
                </summary>
                <div className="capture-detail-more-menu workbench-meta-more-menu">
                  <p className="workbench-meta-menu-static" title="保存目标集合模块">
                    <span className="workbench-meta-menu-static-icon" aria-hidden>
                      <WorkbenchSaveCollectionIcon />
                    </span>
                    保存至「{activeCollectionName}」
                  </p>
                  {activeRequestId ? (
                    <button
                      type="button"
                      className="capture-detail-more-item capture-detail-more-item--danger"
                      onClick={() => deleteActive()}
                    >
                      删除当前请求
                    </button>
                  ) : null}
                </div>
              </details>
            </div>
          </div>

          <div
            className={`workbench-editor-zone workbench-editor-zone--request${
              requestPaneCompact ? " workbench-editor-zone--request-compact" : ""
            }`}
          >
            <div className="workbench-req-tabs-bar">
              <div className="workbench-req-tabs workbench-req-tabs--segmented" role="tablist" aria-label="请求配置">
                {(
                  [
                    ["params", "Params"],
                    ["headers", `Headers (${headerCount})`],
                    ["body", protocol === "ws" ? "Message" : "Body"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={reqTab === id}
                    className={`workbench-tab${reqTab === id ? " active" : ""}`}
                    onClick={() => setReqTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="workbench-editor-pane">
              {reqTab === "params" && (
                <WorkbenchKvTable
                  ref={queryKvRef}
                  rows={draft.query}
                  bulkFormat="query"
                  onChange={updateQueryRow}
                  onAdd={() => setDraft((d) => ({ ...d, query: [...d.query, emptyRow()] }))}
                  onRemove={removeQueryRow}
                  onReplaceAll={replaceQueryRows}
                  onReorder={reorderQueryRow}
                  onBulkOpenChange={setKvBulkOpen}
                />
              )}
              {reqTab === "headers" && (
                <WorkbenchKvTable
                  ref={headersKvRef}
                  rows={draft.headers}
                  bulkFormat="json"
                  onChange={updateHeaderRow}
                  onAdd={() => setDraft((d) => ({ ...d, headers: [...d.headers, emptyRow()] }))}
                  onRemove={removeHeaderRow}
                  onReplaceAll={replaceHeaderRows}
                  onReorder={reorderHeaderRow}
                  onBulkOpenChange={setKvBulkOpen}
                />
              )}
              {reqTab === "body" && (
                <div
                  className={`workbench-body-pane${
                    protocol === "http" && draft.bodyMode === "none" ? " workbench-body-pane--none" : ""
                  }`}
                >
                  {protocol === "http" ? (
                    <>
                      <div
                        className="run-detail-segmented workbench-body-mode-segmented"
                        role="radiogroup"
                        aria-label="请求体类型"
                      >
                        <button
                          type="button"
                          role="radio"
                          aria-checked={draft.bodyMode === "none"}
                          className={`run-detail-segmented-btn${
                            draft.bodyMode === "none" ? " run-detail-segmented-btn--active" : ""
                          }`}
                          onClick={() => setDraft((d) => ({ ...d, bodyMode: "none" }))}
                        >
                          none
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={draft.bodyMode === "raw"}
                          className={`run-detail-segmented-btn${
                            draft.bodyMode === "raw" ? " run-detail-segmented-btn--active" : ""
                          }`}
                          onClick={() => setDraft((d) => normalizeRawBodyDraft({ ...d, bodyMode: "raw" }))}
                        >
                          raw
                        </button>
                      </div>
                      {draft.bodyMode === "none" ? (
                        <p className="workbench-body-none-hint">当前请求不包含 Body 数据。</p>
                      ) : (
                        <div className="workbench-body-raw">
                          <div className="workbench-body-raw-toolbar">
                            <span className="workbench-body-raw-toolbar-label">Content-Type</span>
                            <AppCustomSelect
                              variant="inline"
                              className="workbench-content-type"
                              value={draft.bodyContentType ?? "application/json"}
                              ariaLabel="Content-Type"
                              options={bodyContentTypeOptions}
                              onChange={(bodyContentType) => setDraft((d) => ({ ...d, bodyContentType }))}
                            />
                          </div>
                          <textarea
                            className="workbench-body-textarea"
                            value={draft.body}
                            spellCheck={false}
                            placeholder='例如 {"key": "value"}'
                            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <textarea
                      className="workbench-body-textarea"
                      value={draft.body}
                      spellCheck={false}
                      placeholder="连接后点击 Send 发送此消息…"
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, bodyMode: "raw", body: e.target.value }))
                      }
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          <div
            className={`workbench-vsplit${splitDragging ? " workbench-vsplit--active" : ""}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label="拖动调整 Messages / Response 高度"
            tabIndex={0}
            onMouseDown={onResponseSplitMouseDown}
            onKeyDown={onResponseSplitKeyDown}
            title="拖动调整下方 Messages / Response 区域高度"
          />

          <div
            className="workbench-editor-zone workbench-editor-zone--response workbench-response"
            style={{ flex: "1 1 0", minHeight: responsePaneHeight }}
          >
            <div className="workbench-response-head">
              <div className="workbench-response-head-row workbench-response-head-row--primary">
                {protocol === "ws" ? (
                  <span className="workbench-response-title workbench-response-title--ws">
                    <span
                      className={`workbench-ws-status-dot workbench-ws-status-dot--sm${
                        wsOpen
                          ? " workbench-ws-status-dot--open"
                          : wsConnecting
                            ? " workbench-ws-status-dot--connecting"
                            : " workbench-ws-status-dot--closed"
                      }`}
                      aria-hidden
                    />
                    Messages
                  </span>
                ) : (
                  <div className="workbench-resp-tabs workbench-resp-tabs--underline" role="tablist" aria-label="响应">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={respView === "body"}
                      className={`workbench-resp-tab${respView === "body" ? " workbench-resp-tab--active" : ""}`}
                      onClick={() => setRespView("body")}
                    >
                      Body
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={respView === "headers"}
                      className={`workbench-resp-tab${respView === "headers" ? " workbench-resp-tab--active" : ""}`}
                      onClick={() => setRespView("headers")}
                    >
                      Headers
                    </button>
                  </div>
                )}
                {protocol === "http" && response ? (
                  <div className="workbench-status-chips" role="group" aria-label="响应摘要">
                    <span
                      className={`workbench-status-chip workbench-status-chip--code ${httpStatusTone(
                        response.status,
                        response.ok,
                      )}`}
                    >
                      <span className="workbench-status-chip-dot" aria-hidden />
                      {(response.status || "—") + (response.statusText ? ` ${response.statusText}` : "")}
                    </span>
                    <span className="workbench-status-chip workbench-status-chip--meta">
                      <span className="workbench-status-chip-icon" aria-hidden>
                        ⏱
                      </span>
                      {response.durationMs} ms
                    </span>
                    <span className="workbench-status-chip workbench-status-chip--meta">
                      <span className="workbench-status-chip-icon" aria-hidden>
                        ▣
                      </span>
                      {response.bodySize} B
                    </span>
                  </div>
                ) : null}
                {protocol === "ws" ? (
                  <span
                    className={`workbench-status-chip workbench-status-chip--code ${wsOpen ? "ok" : wsConnecting ? "" : "err"}`}
                  >
                    <span className="workbench-status-chip-dot" aria-hidden />
                    {wsOpen ? "OPEN" : wsConnecting ? "CONNECTING…" : "CLOSED"}
                  </span>
                ) : null}
              </div>
              {protocol === "http" && responseJson != null && respView === "body" ? (
                <div className="workbench-response-head-row workbench-response-head-row--tools" role="toolbar" aria-label="响应体工具">
                  <span className="workbench-response-head-spacer" />
                  <div className="run-detail-segmented workbench-response-format-segmented" role="group" aria-label="响应体格式">
                    <button
                      type="button"
                      className={`run-detail-segmented-btn${respBodyMode === "visual" ? " run-detail-segmented-btn--active" : ""}`}
                      onClick={() => setRespBodyMode("visual")}
                    >
                      可视化
                    </button>
                    <button
                      type="button"
                      className={`run-detail-segmented-btn${respBodyMode === "raw" ? " run-detail-segmented-btn--active" : ""}`}
                      onClick={() => setRespBodyMode("raw")}
                    >
                      JSON
                    </button>
                  </div>
                  {respBodyMode === "raw" ? (
                    <div className="workbench-response-json-actions">
                      <button
                        type="button"
                        className="run-detail-response-icon-btn"
                        title="复制响应体"
                        aria-label="复制"
                        onClick={() => void copyResponseBody()}
                      >
                        <span aria-hidden>📋</span>
                        <span>复制</span>
                      </button>
                      <button
                        type="button"
                        className="run-detail-response-icon-btn"
                        title={respJsonPretty ? "压缩为一行" : "格式化缩进"}
                        aria-label={respJsonPretty ? "压缩" : "格式化"}
                        onClick={() => setRespJsonPretty((v) => !v)}
                      >
                        <span className="run-detail-response-format-icon" aria-hidden>
                          {"{}"}
                        </span>
                        <span>{respJsonPretty ? "压缩" : "格式化"}</span>
                      </button>
                    </div>
                  ) : (
                    <span className="workbench-response-export">
                      <button
                        type="button"
                        className="nav-btn nav-btn--compact"
                        disabled={visualExportBusy}
                        title="导出接口返回的全部数据（多工作表）"
                        onClick={() => void exportVisualTable("xlsx", "all")}
                      >
                        XLSX·全部
                      </button>
                      <button
                        type="button"
                        className="nav-btn nav-btn--compact"
                        disabled={visualExportBusy || visualSelectedCount === 0}
                        title={
                          visualSelectedCount
                            ? `仅导出已勾选的 ${visualSelectedCount} 行`
                            : "请先在表中勾选行"
                        }
                        onClick={() => void exportVisualTable("xlsx", "selected")}
                      >
                        XLSX·所选{visualSelectedCount ? ` (${visualSelectedCount})` : ""}
                      </button>
                      <button
                        type="button"
                        className="nav-btn nav-btn--compact"
                        disabled={
                          visualExportBusy || visualSelectedCount === 0 || visualSelectedCount > PNG_EXPORT_MAX_ROWS
                        }
                        title={
                          visualSelectedCount > PNG_EXPORT_MAX_ROWS
                            ? `PNG 最多 ${PNG_EXPORT_MAX_ROWS} 条，请减少勾选`
                            : `仅导出已勾选的行（最多 ${PNG_EXPORT_MAX_ROWS} 条）`
                        }
                        onClick={() => void exportVisualTable("png")}
                      >
                        PNG·所选
                        {visualSelectedCount ? ` (${visualSelectedCount}/${PNG_EXPORT_MAX_ROWS})` : ""}
                      </button>
                    </span>
                  )}
                </div>
              ) : protocol === "ws" && wsLog.length > 0 ? (
                <div className="workbench-response-head-row workbench-response-head-row--tools">
                  <span className="workbench-response-head-spacer" />
                  <button type="button" className="workbench-tab small" onClick={() => setWsLog([])}>
                    清空
                  </button>
                </div>
              ) : null}
            </div>
            {protocol === "http" && wsSwitchHint && response ? (
              <div className="workbench-ws-hint">
                <p>
                  当前地址（<code>{(() => { const u = buildUrl(draft.url, draft.query); return u.length > 88 ? `${u.slice(0, 88)}…` : u; })()}</code>）含{" "}
                  <code>/ws</code> 等特征，多为<strong> WebSocket 推送</strong>，HTTP GET 常返回{" "}
                  {response.status}。WebSocket 行情请切到 WS 并确认证书、URL 为 <code>wss://</code>。
                </p>
                <button type="button" className="primary" onClick={switchToWebSocketMode}>
                  切换为 WebSocket（wss）
                </button>
              </div>
            ) : null}
            <div className="workbench-response-body">
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
                  <div className="workbench-response-empty">
                    <span className="workbench-response-empty-glyph" aria-hidden>
                      ◇
                    </span>
                    <p className="workbench-response-placeholder-hint">Connect 后消息将显示在此处</p>
                  </div>
                </div>
              )
            ) : !response ? (
              <div className="workbench-response-placeholder">
                <div className="workbench-response-empty">
                  <span className="workbench-response-empty-glyph" aria-hidden>
                    API
                  </span>
                  <p className="workbench-response-placeholder-hint">填写 URL 后点击 Send，响应将显示在此处</p>
                </div>
              </div>
            ) : respView === "headers" ? (
              <CaptureCodeBlock
                fullText={JSON.stringify(response.headers, null, 2)}
                language="json"
                hideToolbar
                jsonPretty={respJsonPretty}
                onJsonPrettyChange={setRespJsonPretty}
                maxHeight="100%"
                ariaLabel="响应 Headers"
                className="workbench-response-json-block"
              />
            ) : responseImageSrc ? (
              <div className="workbench-response-image-pane">
                <img className="workbench-response-image" src={responseImageSrc} alt="响应图片" />
                <p className="hint workbench-response-image-meta">{responseBodyDisplay}</p>
              </div>
            ) : responseJson != null && respBodyMode === "visual" ? (
              <JsonResponseView
                ref={jsonVisualRef}
                data={responseJson}
                className="workbench-response-visual"
                onSelectionChange={(sel) => setVisualSelectedCount(countSelectedRows(sel))}
              />
            ) : responseJson != null && respBodyMode === "raw" ? (
              <CaptureCodeBlock
                fullText={responseBodyDisplay || response.error || "(空响应)"}
                language="json"
                hideToolbar
                jsonPretty={respJsonPretty}
                onJsonPrettyChange={setRespJsonPretty}
                maxHeight="100%"
                ariaLabel="响应 JSON"
                className="workbench-response-json-block"
              />
            ) : (
              <pre className="workbench-response-pre workbench-response-pre--scroll">
                {responseBodyDisplay || response.error || "(空响应)"}
              </pre>
            )}
            </div>
          </div>
        </section>
      </div>

      <ImportCurlDialog
        open={importCurlOpen}
        onCancel={() => setImportCurlOpen(false)}
        onImport={(draft, warnings) => {
          void (async () => {
            setImportCurlOpen(false);
            let normalized = normalizeRawBodyDraft(draft);
            const { draft: withAuth, savedKeys } = await applyImportedCurlAuth(project, envName, normalized);
            normalized = withAuth;
            if (savedKeys.length && project) {
              void refreshVariables();
            }
            setDraft(normalized);
            setActiveRequestId(null);
            setResponse(null);
            resetWsSession();
            if (isWsUrl(normalized.url)) setProtocol("ws");
            else setProtocol("http");
            const warnPart = warnings.length ? warnings.join("；") : "";
            if (savedKeys.length) {
              showToast(
                warnPart
                  ? `已导入 cURL，${savedKeys.join("、")} 已写入 env:${envName}（*.local.yaml）· ${warnPart}`
                  : `已导入 cURL，${savedKeys.join("、")} 已写入 env:${envName}（*.local.yaml）`,
              );
            } else if (!project) {
              showToast(
                warnPart
                  ? `已导入 cURL；选择项目后可自动保存 token/secret 到环境 · ${warnPart}`
                  : "已导入 cURL；选择项目后可自动保存 token/secret 到环境",
              );
            } else {
              showToast(warnPart ? `已导入 cURL（${warnPart}）` : "已导入 cURL");
            }
          })();
        }}
      />

      <CaseSaveConflictDialog
        open={pendingCaseConflict !== null}
        caseName={pendingCaseConflict?.caseName ?? ""}
        renameDefault={pendingCaseConflict?.renameDefault ?? ""}
        onCancel={() => {
          setPendingCaseConflict(null);
          showToast("未更新用例，集合已保存");
        }}
        onOverwrite={() => {
          const pending = pendingCaseConflict;
          if (!pending) return;
          setPendingCaseConflict(null);
          void (async () => {
            const res = await writeProjectCase(pending.projectId, pending.caseName, pending.yaml, true);
            if (!res.ok) {
              showToast(res.error ?? "覆盖用例失败");
              return;
            }
            onCaseSaved?.();
            showToast(`已覆盖 cases/${pending.caseName}.yaml（已加入套件 ${CASE_SUITE_DEFAULT}）`);
          })();
        }}
        onSaveAs={(newCaseName) => {
          const pending = pendingCaseConflict;
          if (!pending) return;
          setPendingCaseConflict(null);
          void (async () => {
            const res = await writeProjectCase(pending.projectId, newCaseName, pending.yaml);
            if (!res.ok) {
              showToast(res.error ?? "另存用例失败");
              return;
            }
            onCaseSaved?.();
            showToast(`已另存为 cases/${newCaseName}.yaml（已加入套件 ${CASE_SUITE_DEFAULT}）`);
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

      {toast && (
        <div className="app-toast" role="status">
          <span className="app-toast-dot" />
          {toast}
        </div>
      )}
    </div>
  );
}

