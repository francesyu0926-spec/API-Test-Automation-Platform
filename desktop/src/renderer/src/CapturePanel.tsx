import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

type CaptureProxyMode = "pac" | "global" | "embedded";

const CAPTURE_PROXY_MODE_OPTIONS: { value: CaptureProxyMode; label: string; hint: string }[] = [
  { value: "pac", label: "PAC（按域名）", hint: "仅填写的 API 域名走 mitm，其它流量直连" },
  { value: "embedded", label: "内嵌网页", hint: "广域 PAC，适合壳层 / WebView" },
  { value: "global", label: "全局代理", hint: "全部流量经代理，部分客户端易白屏" },
];

import ConfirmDialog from "./ConfirmDialog";
import AppCustomSelect from "./AppCustomSelect";
import CaptureSessionsDialog from "./CaptureSessionsDialog";
import LoadingOverlay from "./LoadingOverlay";
import BatchSaveCasesDialog from "./BatchSaveCasesDialog";
import SaveCaseDialog from "./SaveCaseDialog";
import { originFromUrl } from "./ProjectTargetField";
import { persistCaseAuthFromCapture } from "./samplerAuth";

const CAPTURE_CASE_ENV = "dev";
import { captureTxToDraft } from "./apiWorkbenchModel";
import { buildBatchCaseRows } from "./captureBatchCases";
import { captureTxToCaseMeta, captureTxToCaseYaml } from "./caseYaml";
import { transactionToCurl } from "./captureCurl";
import { filterTransactions, isCaptureSelfTestRow } from "./captureFilters";
import { embeddedBypassBlocksApiCapture } from "./capturePacHints";
import type { ProjectCaptureProfile } from "../../shared/captureProfile";
import {
  asCaptureTransaction,
  captureBodyImageSrc,
  estimateBodyBytes,
  formatCaptureBodyText,
  headerEntries,
  pickContentType,
  responseStatusTone,
  sniffImageMime,
} from "./captureTransactionView";
import { httpStatusTone } from "./apiWorkbenchModel";
import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";

const pacHostsStorageKey = (projectId: string) => `atp-capture-pac-hosts:${projectId || "_"}`;
const PAC_HOSTS_PLACEHOLDER = "api.example.com,api.yourcorp.com";

type CaptureDetailTab = "response" | "request" | "curl" | "yaml" | "raw";

type PendingConfirm = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => void | Promise<void>;
};

type Session = Awaited<ReturnType<typeof window.atp.listCaptureSessions>>[number];
type TxRow = Awaited<ReturnType<typeof window.atp.getCaptureIndex>>["transactions"][number];

const TX_PAGE_SIZE = 10;

/** ISO 时间字符串：新 → 旧 */
function compareCapturedAtDesc(a: TxRow, b: TxRow): number {
  const ta = a.captured_at || "";
  const tb = b.captured_at || "";
  if (tb !== ta) return tb.localeCompare(ta);
  return b.id.localeCompare(a.id);
}

function isCertInstallBannerMessage(text: string): boolean {
  return /证书已装入|受信任的根证书|chrome:\/\/restart|mitm\.it/i.test(text);
}

function formatSessionPickerShort(sessionId: string): string {
  return formatCaptureSessionHeadline(sessionId).replace(/:\d{2}$/, "");
}

function formatCaptureSessionHeadline(sessionId: string): string {
  const head = sessionId.split("-")[0] ?? sessionId;
  const m = head.match(/^(\d{4})(\d{2})(\d{2})[Tt]?(\d{2})(\d{2})(\d{2})/i);
  if (!m) return sessionId.slice(0, 12);
  const [, y, mo, d, h, mi, s] = m;
  const parsed = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  if (!Number.isNaN(parsed.getTime())) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
  }
  return `${mo}-${d} ${h}:${mi}:${s}`;
}

function captureSessionIdHash(sessionId: string): string {
  const dash = sessionId.indexOf("-");
  if (dash < 0) return sessionId.slice(0, 8);
  return sessionId.slice(dash + 1, dash + 9);
}

function formatCaptureListTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  const trimmed = iso.replace(/\.(\d{3})\d*Z?$/, ".$1").replace(/Z$/, " UTC");
  const m = trimmed.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  return iso.replace("T", " ").replace(/Z$/, "");
}

function httpMethodBadgeClass(method: string): string {
  const m = method.toUpperCase();
  if (m === "GET") return "capture-method-badge capture-method-badge--get";
  if (m === "POST") return "capture-method-badge capture-method-badge--post";
  if (m === "PUT" || m === "PATCH") return "capture-method-badge capture-method-badge--mutate";
  if (m === "DELETE") return "capture-method-badge capture-method-badge--delete";
  if (m === "OPTIONS" || m === "HEAD") return "capture-method-badge capture-method-badge--meta";
  return "capture-method-badge capture-method-badge--other";
}

function captureIndexRowsEqual(a: TxRow[], b: TxRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if (a[i].status !== b[i].status) return false;
    if (a[i].method !== b[i].method) return false;
    if (a[i].url !== b[i].url) return false;
  }
  return true;
}

type Props = {
  project: string;
  projectName: string;
  onOpenInWorkbench?: (draft: WorkbenchDraft) => void;
  onCaseSaved?: () => void;
  onGoToProjects?: () => void;
};

export default function CapturePanel({
  project,
  projectName,
  onOpenInWorkbench,
  onCaseSaved,
  onGoToProjects,
}: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [label, setLabel] = useState("");
  const [proxyMode, setProxyMode] = useState<CaptureProxyMode>("pac");
  const [pacHosts, setPacHosts] = useState("");
  const [captureProfile, setCaptureProfile] = useState<ProjectCaptureProfile | null>(null);
  const [ingest, setIngest] = useState<Awaited<ReturnType<typeof window.atp.getIngestStatus>>>({
    running: false,
  });
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [selectedTx, setSelectedTx] = useState<unknown | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftYaml, setDraftYaml] = useState("");
  const [draftCurl, setDraftCurl] = useState("");
  const [detailToast, setDetailToast] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [pendingCaseOverwrite, setPendingCaseOverwrite] = useState<{
    projectId: string;
    caseName: string;
    addToSuite: boolean;
    suiteName: string;
    yaml: string;
  } | null>(null);
  const [saveCaseOpen, setSaveCaseOpen] = useState(false);
  const [mitm, setMitm] = useState<Awaited<ReturnType<typeof window.atp.mitmStatus>>>({ running: false });
  const [mitmAvail, setMitmAvail] = useState(false);
  const [apiOnlyFilter, setApiOnlyFilter] = useState(true);
  const [followLatest, setFollowLatest] = useState(false);
  const [pendingNewTxCount, setPendingNewTxCount] = useState(0);
  const [trafficSearch, setTrafficSearch] = useState("");
  const [txPage, setTxPage] = useState(1);
  const visibleListLenRef = useRef(0);
  const wasCapturingRef = useRef(false);
  const [sysProxy, setSysProxy] = useState<{ enabled: boolean; server: string; autoConfigUrl?: string }>({
    enabled: false,
    server: "",
  });
  const [sessionsDeleteOpen, setSessionsDeleteOpen] = useState(false);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [txDetailLoading, setTxDetailLoading] = useState(false);
  const [checkedTxIds, setCheckedTxIds] = useState<Set<string>>(() => new Set());
  const [batchSaveOpen, setBatchSaveOpen] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [detailTab, setDetailTab] = useState<CaptureDetailTab>("response");
  const [captureHelpOpen, setCaptureHelpOpen] = useState(false);
  const [captureAdvancedOpen, setCaptureAdvancedOpen] = useState(false);
  const [certInstallDetail, setCertInstallDetail] = useState<string | null>(null);

  useEffect(() => {
    if (!project) {
      setCaptureProfile(null);
      return;
    }
    void window.atp.getProjectCaptureProfile(project).then(setCaptureProfile);
  }, [project]);

  const protectedApiHosts = useMemo(() => captureProfile?.pacHosts ?? [], [captureProfile]);

  useEffect(() => {
    if (!project) {
      setPacHosts("");
      return;
    }
    try {
      const saved = localStorage.getItem(pacHostsStorageKey(project));
      if (saved != null && saved.trim()) {
        setPacHosts(saved.trim());
        return;
      }
    } catch {
      /* ignore */
    }
    setPacHosts(captureProfile?.pacHostsCsv ?? "");
  }, [project, captureProfile?.pacHostsCsv]);

  useEffect(() => {
    if (!project) return;
    try {
      const trimmed = pacHosts.trim();
      const key = pacHostsStorageKey(project);
      if (trimmed) localStorage.setItem(key, trimmed);
      else localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, [project, pacHosts]);

  const capturing = ingest.running || mitm.running;
  const controlMessage = useMemo(() => {
    if (!message) return "";
    if (mitm.running && ingest.running && /MITM\s*未运行/i.test(message)) return "";
    return message;
  }, [message, mitm.running, ingest.running]);
  const embeddedMisconfigured = useMemo(
    () => proxyMode === "embedded" && embeddedBypassBlocksApiCapture(pacHosts, protectedApiHosts).length > 0,
    [proxyMode, pacHosts, protectedApiHosts],
  );
  const embeddedBlockedHosts = useMemo(
    () =>
      embeddedMisconfigured ? embeddedBypassBlocksApiCapture(pacHosts, protectedApiHosts) : [],
    [embeddedMisconfigured, pacHosts, protectedApiHosts],
  );
  const applyProjectPacTemplate = () => {
    setProxyMode("pac");
    const csv = captureProfile?.pacHostsCsv?.trim();
    if (csv) {
      setPacHosts(csv);
      setMessage("");
      return;
    }
    setMessage("未配置 PAC 主机：请在项目 project.yaml 的 capture.pac_hosts 中填写，或在环境变量 base_url 等中提供 API 地址。");
  };
  const applyPacPreset = (hosts: string) => {
    setProxyMode("pac");
    setPacHosts(hosts.trim());
  };

  const businessTxCount = useMemo(
    () => transactions.filter((t) => !isCaptureSelfTestRow(t)).length,
    [transactions],
  );
  const probeTxCount = transactions.length - businessTxCount;
  const withoutProbeTransactions = useMemo(
    () => transactions.filter((t) => !isCaptureSelfTestRow(t)),
    [transactions],
  );
  const lockedCaptureSessionId =
    ingest.running && ingest.sessionId && ingest.project === project ? ingest.sessionId : null;
  const activeSessionId =
    ingest.running && ingest.sessionId ? ingest.sessionId : selectedSession;

  const visibleTransactions = useMemo(() => {
    const q = trafficSearch.trim().toLowerCase();
    const source = q
      ? withoutProbeTransactions.filter(
          (t) =>
            t.url.toLowerCase().includes(q) ||
            t.path.toLowerCase().includes(q) ||
            t.method.toLowerCase().includes(q),
        )
      : apiOnlyFilter
        ? (() => {
            const apiRows = filterTransactions(transactions, true);
            if (apiRows.length) return apiRows;
            if (withoutProbeTransactions.length) return withoutProbeTransactions;
            return [];
          })()
        : withoutProbeTransactions;
    const useChronological = capturing && !followLatest && !q;
    return useChronological ? source : [...source].sort(compareCapturedAtDesc);
  }, [transactions, apiOnlyFilter, trafficSearch, withoutProbeTransactions, capturing, followLatest]);

  const apiMatchCount = useMemo(
    () => filterTransactions(transactions, true).length,
    [transactions],
  );
  const showingAllDespiteApiFilter =
    apiOnlyFilter &&
    !trafficSearch.trim() &&
    withoutProbeTransactions.length > 0 &&
    apiMatchCount === 0;

  useEffect(() => {
    setCheckedTxIds(new Set());
  }, [activeSessionId, project]);

  const pagedTransactions = useMemo(() => {
    const start = (txPage - 1) * TX_PAGE_SIZE;
    return visibleTransactions.slice(start, start + TX_PAGE_SIZE);
  }, [visibleTransactions, txPage]);

  const txPageCount = Math.max(1, Math.ceil(visibleTransactions.length / TX_PAGE_SIZE) || 1);

  const selectedCount = checkedTxIds.size;
  const pageIds = useMemo(() => pagedTransactions.map((t) => t.id), [pagedTransactions]);
  const allPageChecked = pageIds.length > 0 && pageIds.every((id) => checkedTxIds.has(id));
  const toggleTxChecked = (txId: string) => {
    setCheckedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  };

  const togglePageSelection = () => {
    setCheckedTxIds((prev) => {
      const next = new Set(prev);
      if (allPageChecked) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  };

  const clearTxSelection = () => setCheckedTxIds(new Set());

  const selectAllVisible = () => {
    setCheckedTxIds(new Set(visibleTransactions.map((t) => t.id)));
  };

  const batchCaseRows = useMemo(
    () =>
      buildBatchCaseRows(visibleTransactions.filter((t) => checkedTxIds.has(t.id))),
    [visibleTransactions, checkedTxIds],
  );

  const runBatchSave = async (opts: {
    projectId: string;
    items: ReturnType<typeof buildBatchCaseRows>;
    addToSuite: boolean;
    suiteName: string;
    overwriteExisting: boolean;
    openProjects: boolean;
  }) => {
    const sid = activeSessionId;
    const captureProject = project;
    if (!captureProject || !sid || !opts.projectId) return;
    setBatchSaving(true);
    let saved = 0;
    let skipped = 0;
    let failed = 0;
    try {
      for (const item of opts.items) {
        const caseName = item.caseName.trim();
        if (!caseName) {
          failed += 1;
          continue;
        }
        const exists = await window.atp.projectCaseExists(opts.projectId, caseName);
        if (exists && !opts.overwriteExisting) {
          skipped += 1;
          continue;
        }
        const tx = await window.atp.getCaptureTransaction(captureProject, sid, item.txId);
        if (!tx) {
          failed += 1;
          continue;
        }
        const yaml = captureTxToCaseYaml(tx);
        await persistCaseAuthFromCapture(opts.projectId, CAPTURE_CASE_ENV, tx);
        const res = await window.atp.saveProjectCase(opts.projectId, caseName, yaml, {
          addToSuite: opts.addToSuite ? opts.suiteName : undefined,
          overwrite: opts.overwriteExisting,
        });
        if (res.ok) saved += 1;
        else if (res.exists && !opts.overwriteExisting) skipped += 1;
        else failed += 1;
      }
    } finally {
      setBatchSaving(false);
      setBatchSaveOpen(false);
      clearTxSelection();
    }
    const parts = [
      saved ? `已保存 ${saved} 个` : "",
      skipped ? `跳过 ${skipped} 个已存在` : "",
      failed ? `失败 ${failed} 个` : "",
    ].filter(Boolean);
    showDetailToast(parts.length ? parts.join("，") : "未保存任何用例");
    if (saved > 0) {
      onCaseSaved?.();
      if (opts.openProjects) onGoToProjects?.();
    }
  };

  const emptyListState = useMemo(() => {
    if (visibleTransactions.length > 0) return null;
    const q = trafficSearch.trim();
    if (q) {
      return {
        title: "无匹配流量",
        hint: `没有包含「${q}」的记录。可清空搜索，或关闭「仅 API」查看业务流量（${businessTxCount} 条）。`,
        action: "clearSearch" as const,
      };
    }
    if (capturing) {
      if (probeTxCount > 0 && businessTxCount === 0) {
        return {
          title: "等待业务流量",
          hint:
            "开始抓包时有一条 www.baidu.com 链路自检（验证 MITM→Ingest），不会出现在列表中。请用 Chrome 或已重启的目标客户端访问站点；默认按写入顺序展示，新请求在末页，可勾选「跟进最新」。",
          action: null,
        };
      }
      return {
        title: "等待流量",
        hint: "用 Chrome 访问目标站点（HTTPS 需已安装证书并重开浏览器）。新流量默认追加到末页，避免列表跳动。",
        action: null,
      };
    }
    if (!activeSessionId) {
      return {
        title: "暂无抓包数据",
        hint: "开始抓包后，在目标客户端操作，流量将出现在此列表。",
        action: "startCapture" as const,
      };
    }
    return {
      title: "本会话暂无记录",
      hint: "该会话尚未写入流量，或已被清空列表。可重新开始抓包并操作目标应用。",
      action: "startCapture" as const,
    };
  }, [
    visibleTransactions.length,
    trafficSearch,
    transactions.length,
    businessTxCount,
    probeTxCount,
    apiOnlyFilter,
    apiMatchCount,
    capturing,
    activeSessionId,
  ]);

  const refreshSessions = useCallback(async () => {
    if (!project) return;
    const list = await window.atp.listCaptureSessions(project);
    setSessions(list);
    setSelectedSession((prev) => {
      if (prev && list.some((s) => s.id === prev)) return prev;
      return list.length ? list[0].id : "";
    });
  }, [project]);

  useEffect(() => {
    setTxPage(1);
    setPendingNewTxCount(0);
    visibleListLenRef.current = 0;
  }, [activeSessionId, apiOnlyFilter]);

  useEffect(() => {
    if (capturing && !wasCapturingRef.current) {
      setFollowLatest(false);
      setPendingNewTxCount(0);
      visibleListLenRef.current = 0;
    }
    wasCapturingRef.current = capturing;
  }, [capturing]);

  useEffect(() => {
    if (!capturing || followLatest) {
      setPendingNewTxCount(0);
      visibleListLenRef.current = visibleTransactions.length;
      return;
    }
    const prevLen = visibleListLenRef.current;
    const nextLen = visibleTransactions.length;
    if (prevLen > 0 && nextLen > prevLen) {
      setPendingNewTxCount((n) => n + (nextLen - prevLen));
    }
    visibleListLenRef.current = nextLen;
  }, [visibleTransactions.length, capturing, followLatest]);

  useEffect(() => {
    if (!capturing || !followLatest) return;
    setPendingNewTxCount(0);
    setTxPage(1);
  }, [visibleTransactions.length, capturing, followLatest]);

  useEffect(() => {
    if (txPage > txPageCount) setTxPage(txPageCount);
  }, [txPage, txPageCount]);

  const refreshIndex = useCallback(
    async (opts?: { silent?: boolean }) => {
      const sid = activeSessionId;
      if (!project || !sid) {
        setTransactions([]);
        return;
      }
      if (!opts?.silent) setTrafficLoading(true);
      try {
        const { transactions: txs } = await window.atp.getCaptureIndex(project, sid);
        const next = Array.isArray(txs) ? txs : [];
        setTransactions((prev) => (captureIndexRowsEqual(prev, next) ? prev : next));
      } catch (err) {
        console.error("getCaptureIndex failed", err);
        if (!opts?.silent) setMessage("加载流量列表失败，请停止抓包后重试");
      } finally {
        if (!opts?.silent) setTrafficLoading(false);
      }
    },
    [project, activeSessionId],
  );

  useEffect(() => {
    setSelectedSession("");
    setSelectedTx(null);
    setDraftYaml("");
    void refreshSessions();
    void window.atp.mitmAvailability().then((a) => setMitmAvail(a.available));
  }, [project, refreshSessions]);

  useEffect(() => {
    void refreshIndex();
  }, [refreshIndex]);

  useEffect(() => {
    const tick = async () => {
      try {
        const st = await window.atp.getIngestStatus();
        setIngest(st);
        setMitm(await window.atp.mitmStatus());
        setSysProxy(await window.atp.systemProxyStatus());
        if (st.running || activeSessionId) await refreshIndex({ silent: true });
      } catch (err) {
        console.error("capture status tick failed", err);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 2000);
    return () => clearInterval(id);
  }, [activeSessionId, refreshIndex]);

  useEffect(() => {
    if (ingest.running && ingest.sessionId && ingest.sessionId !== selectedSession) {
      setSelectedSession(ingest.sessionId);
    }
  }, [ingest.running, ingest.sessionId, selectedSession]);

  const refreshStatus = async () => {
    setIngest(await window.atp.getIngestStatus());
    setMitm(await window.atp.mitmStatus());
    setSysProxy(await window.atp.systemProxyStatus());
    await refreshSessions();
    await refreshIndex();
  };

  const notifyCaptureIssue = useCallback((text: string, opts?: { expandPac?: boolean }) => {
    setMessage(text);
    setDetailToast(text);
    window.setTimeout(() => setDetailToast(""), 4200);
    if (opts?.expandPac) setCaptureAdvancedOpen(true);
  }, []);

  const runQuickCaptureStart = async (pacHostsOverride?: string) => {
    if (!project) return;
    setBusy(true);
    setMessage("");
    const hostFilter =
      proxyMode === "pac" || proxyMode === "embedded"
        ? (pacHostsOverride ?? pacHosts).trim()
        : "";
    const res = await window.atp.quickCaptureStart({
      project,
      label,
      hostFilter,
      sessionId: undefined,
      setSystemProxy: true,
      proxyMode,
    });
    setBusy(false);
    if (!res.ok) {
      const base = res.error ?? "启动失败";
      setMessage(base);
      showDetailToast(base);
      const d = await window.atp.captureDiagnose(8888);
      if (d.issues.length) {
        const full = `${base} · ${d.issues.join("；")}`;
        setMessage(full);
        showDetailToast(full);
      }
      return;
    }
    if (res.sessionId) setSelectedSession(res.sessionId);
    setMessage("");
    await refreshStatus();
    await refreshIndex();
  };

  const onStart = async () => {
    if (!project) {
      notifyCaptureIssue("请先在左上角选择项目");
      return;
    }
    let pacForStart = pacHosts.trim();
    if (proxyMode === "pac" && !pacForStart) {
      const csv = captureProfile?.pacHostsCsv?.trim();
      if (csv) {
        setPacHosts(csv);
        pacForStart = csv;
      }
    }
    if (proxyMode === "pac" && !pacForStart) {
      notifyCaptureIssue(
        "PAC 模式下请填写 API 域名，或点「高级设置」里的「终端 API PAC」一键填入",
        { expandPac: true },
      );
      return;
    }
    const mitmCheck = await window.atp.mitmAvailability();
    setMitmAvail(mitmCheck.available);
    if (!mitmCheck.available) {
      notifyCaptureIssue(
        "未找到 mitmproxy。在仓库根目录执行：python -m venv .venv && .venv\\Scripts\\pip install -r requirements-capture.txt",
      );
      return;
    }
    if (embeddedMisconfigured) {
      const blocked = embeddedBlockedHosts.join(", ");
      setPendingConfirm({
        title: "直连列表会挡住业务 API",
        message: `内嵌网页模式下，「直连域名」不经 mitm。当前含 ${blocked}，这些域名的请求会直连，列表通常为空。建议点取消后改用「PAC（按域名）」并填入项目 API 主机；若仅抓 WebView 外链可仍继续。`,
        confirmLabel: "仍要开始",
        run: () => void runQuickCaptureStart(pacForStart || undefined),
      });
      return;
    }
    await runQuickCaptureStart(pacForStart || undefined);
  };

  const onStop = async () => {
    setBusy(true);
    const res = await window.atp.stopAllCapture(false);
    setBusy(false);
    setMessage(res.message);
    await refreshStatus();
  };

  const onRestoreNetwork = async () => {
    setBusy(true);
    const res = await window.atp.restoreNetworkOnly();
    setBusy(false);
    setMessage(res.message);
    await refreshStatus();
  };

  const proxyStale = sysProxy.enabled && !capturing;
  const onInstallCa = async () => {
    setBusy(true);
    const res = await window.atp.installMitmCa();
    setBusy(false);
    if (res.ok) {
      setCertInstallDetail(res.message);
      showDetailToast("证书已安装");
      setMessage((prev) => (prev && isCertInstallBannerMessage(prev) ? "" : prev));
      return;
    }
    setMessage(res.message);
  };

  const openTx = async (txId: string) => {
    const sid = activeSessionId;
    if (!sid) return;
    setTxDetailLoading(true);
    try {
      const tx = await window.atp.getCaptureTransaction(project, sid, txId);
      setSelectedTx(tx);
      setDetailTab("response");
      setDraftYaml(tx ? captureTxToCaseYaml(tx) : "");
      setDraftCurl(tx ? transactionToCurl(tx) : "");
    } finally {
      setTxDetailLoading(false);
    }
  };

  const showDetailToast = (text: string) => {
    setDetailToast(text);
    window.setTimeout(() => setDetailToast(""), 2800);
  };

  const copyCurl = async () => {
    if (!draftCurl) return;
    try {
      await window.atp.copyText(draftCurl);
      showDetailToast("已复制 cURL 到剪贴板");
    } catch {
      try {
        await navigator.clipboard.writeText(draftCurl);
        showDetailToast("已复制 cURL 到剪贴板");
      } catch {
        showDetailToast("复制失败，请手动选中下方 cURL 文本");
      }
    }
  };

  const copyResponseBody = async () => {
    const parsed = asCaptureTransaction(selectedTx);
    const text = formatCaptureBodyText(parsed?.response?.body);
    if (!text || text === "(无响应体)") {
      showDetailToast("无响应体可复制");
      return;
    }
    try {
      await window.atp.copyText(text);
      showDetailToast("已复制响应 Body");
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        showDetailToast("已复制响应 Body");
      } catch {
        showDetailToast("复制失败");
      }
    }
  };

  const downloadCurl = () => {
    if (!draftCurl) return;
    const blob = new Blob([draftCurl], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `capture-${Date.now()}.sh`;
    a.click();
    URL.revokeObjectURL(href);
    showDetailToast("已下载 cURL 脚本 (.sh)");
  };

  const runClearTransactions = async () => {
    const sid = activeSessionId;
    if (!project || !sid) return;
    setBusy(true);
    const res = await window.atp.clearCaptureTransactions(project, sid);
    setBusy(false);
    if (!res.ok) {
      showDetailToast(res.error ?? "清空失败");
      return;
    }
    setSelectedTx(null);
    setDraftYaml("");
    setDraftCurl("");
    showDetailToast(`已清空 ${res.removed ?? 0} 条记录`);
    await refreshSessions();
    await refreshIndex();
  };

  const runDeleteSessions = async (sessionIds: string[]) => {
    if (!project || !sessionIds.length) return;
    setBusy(true);
    const res = await window.atp.deleteCaptureSessions(project, sessionIds);
    setBusy(false);
    if (res.deleted.length) {
      setSelectedTx(null);
      setDraftYaml("");
      setDraftCurl("");
      if (sessionIds.some((id) => id === selectedSession || id === activeSessionId)) {
        setSelectedSession("");
      }
    }
    setSessionsDeleteOpen(false);
    if (res.failed.length) {
      const msg = res.failed.map((f) => `${f.id.slice(0, 12)}…: ${f.error}`).join("；");
      showDetailToast(`已删 ${res.deleted.length} 个；失败 ${res.failed.length}：${msg}`);
    } else {
      showDetailToast(`已删除 ${res.deleted.length} 个会话`);
    }
    await refreshSessions();
    await refreshIndex();
  };

  const onClearTransactions = () => {
    if (!project || !activeSessionId) return;
    setPendingConfirm({
      title: "清空流量列表",
      message: "将删除当前会话里的全部抓包记录，磁盘文件一并清除。抓包进行中仍可继续写入新流量。",
      confirmLabel: "清空",
      run: () => void runClearTransactions(),
    });
  };

  const onDeleteSessions = () => {
    if (!project || !sessions.length) return;
    setSessionsDeleteOpen(true);
  };

  const proxyEnabledLabel = sysProxy.enabled
    ? sysProxy.autoConfigUrl
      ? "PAC 已启用"
      : sysProxy.server
        ? "代理已启用"
        : "代理已启用"
    : "代理已关闭";

  return (
    <>
      <section className="card capture-control-card">
        <div className="capture-control-head">
          <div className="capture-control-head-bar">
            <div className="capture-control-title-row">
              <h3 className="card-title capture-control-title">控制</h3>
              <button
                type="button"
                className="capture-help-btn"
                aria-label="查看抓包说明"
                aria-expanded={captureHelpOpen}
                title="桌面客户端与 PAC 配置说明"
                onClick={() => setCaptureHelpOpen((v) => !v)}
              >
                ?
              </button>
            </div>
            <div className="capture-control-head-aside">
              <div className="capture-status-badges" aria-label="运行状态">
                <CaptureStatusBadge running={ingest.running} onLabel="Ingest 运行中" offLabel="Ingest 已关闭" />
                <CaptureStatusBadge running={mitm.running} onLabel="MITM 运行中" offLabel="MITM 已关闭" />
                <CaptureStatusBadge running={sysProxy.enabled} onLabel={proxyEnabledLabel} offLabel="代理已关闭" />
              </div>
              <span className="capture-head-aside-divider" aria-hidden />
              <button
                type="button"
                className={`capture-emergency-restore capture-emergency-restore--secondary${proxyStale ? " capture-emergency-restore--urgent" : ""}`}
                disabled={busy}
                title="白屏或 Connecting 时关闭残留系统代理"
                onClick={() => void onRestoreNetwork()}
              >
                <CaptureRestoreNetIcon />
                仅恢复上网
              </button>
            </div>
          </div>
          {captureHelpOpen ? (
            <div className="capture-help-panel" role="region" aria-label="抓包说明">
              <p>
                <strong>桌面客户端</strong>：推荐 <strong>PAC（按域名）</strong>，在高级设置中填写 API 主机。可在{" "}
                <code>project.yaml</code> 配置 <code>capture.pac_hosts</code> 后使用「项目 PAC 模板」。流程：安装证书 → 开始抓包 →
                <strong>完全退出</strong>目标客户端再打开。慎用「全局代理」（易白屏 / Connecting）。
              </p>
              <p className="hint">浏览器抓包需先安装证书；可关闭「仅 API」或按域名搜索过滤列表。</p>
              <button type="button" className="nav-btn nav-btn--compact" onClick={() => setCaptureHelpOpen(false)}>
                知道了
              </button>
            </div>
          ) : null}
        </div>

        <div className="capture-control-main">
          <input
            className="text-input capture-control-field capture-control-label"
            placeholder="备注（可选）"
            value={label}
            disabled={capturing}
            onChange={(e) => setLabel(e.target.value)}
          />
          <AppCustomSelect
            className="capture-proxy-mode-picker"
            variant="control"
            value={proxyMode}
            disabled={capturing}
            ariaLabel="代理模式"
            title={CAPTURE_PROXY_MODE_OPTIONS.find((o) => o.value === proxyMode)?.hint}
            options={CAPTURE_PROXY_MODE_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
              title: o.hint,
            }))}
            onChange={(v) => setProxyMode(v as CaptureProxyMode)}
          />
          {!capturing ? (
            <>
              <button
                type="button"
                className="capture-install-cert-btn capture-control-field"
                disabled={busy}
                onClick={() => void onInstallCa()}
              >
                <CaptureShieldIcon />
                安装证书
              </button>
              {certInstallDetail ? (
                <span className="capture-cert-badge" title={certInstallDetail}>
                  <span className="capture-cert-badge-icon" aria-hidden>
                    ✓
                  </span>
                  证书已安装
                </span>
              ) : null}
            </>
          ) : null}
          {!capturing && activeSessionId ? (
            <CaptureSessionSummaryRow
              sessionId={activeSessionId}
              capturing={false}
              compact
              onCopied={showDetailToast}
            />
          ) : null}
          {!capturing ? (
            <button
              type="button"
              className="primary capture-start-btn capture-control-field"
              disabled={busy || !project}
              onClick={() => void onStart()}
            >
              <CapturePlayIcon />
              开始抓包
            </button>
          ) : (
            <button
              type="button"
              className="capture-stop-btn capture-control-field"
              disabled={busy}
              onClick={() => void onStop()}
            >
              <CaptureStopIcon />
              停止并恢复上网
            </button>
          )}
        </div>

        <div className="capture-control-meta">
          {capturing ? (
            <p className="capture-session-brief">抓包进行中，请在目标客户端内操作；停止后将恢复系统上网设置。</p>
          ) : null}
          {capturing && activeSessionId ? (
            <CaptureSessionSummaryRow
              sessionId={activeSessionId}
              capturing
              onCopied={showDetailToast}
            />
          ) : null}
          {(proxyMode === "pac" || proxyMode === "embedded") && !capturing ? (
            <div className="capture-advanced">
              <button
                type="button"
                className="capture-advanced-toggle capture-advanced-toggle--ghost"
                aria-expanded={captureAdvancedOpen}
                onClick={() => setCaptureAdvancedOpen((v) => !v)}
              >
                <span className="capture-advanced-chevron" aria-hidden>
                  {captureAdvancedOpen ? "▼" : "▶"}
                </span>
                {captureAdvancedOpen ? "收起高级设置（PAC / 直连域名）" : "高级设置（PAC / 直连域名）"}
              </button>
              {captureAdvancedOpen ? (
                <div className="capture-pac-hosts">
                  <span className="capture-pac-hosts-label">
                    {proxyMode === "embedded"
                      ? "可选直连域名（内嵌网页模式下不走 mitm，用于壳层/静态资源）"
                      : "PAC 域名（仅这些主机走 mitm，逗号分隔）"}
                  </span>
                  <div className="capture-pac-hosts-row">
                    <input
                      className="text-input capture-pac-hosts-input"
                      placeholder={
                        proxyMode === "embedded"
                          ? "留空=除内网外公网 HTTPS 均走 mitm；例：cdn.example.com"
                          : PAC_HOSTS_PLACEHOLDER
                      }
                      value={pacHosts}
                      disabled={capturing}
                      onChange={(e) => setPacHosts(e.target.value)}
                    />
                    {proxyMode === "embedded" ? (
                      <button
                        type="button"
                        className="nav-btn nav-btn--compact"
                        disabled={capturing}
                        onClick={() => setPacHosts("")}
                      >
                        清空直连
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="nav-btn nav-btn--compact"
                          disabled={capturing || !captureProfile?.pacHostsCsv}
                          title="填入本项目 capture.pac_hosts（或从环境 base_url 推导）并切换到 PAC"
                          onClick={applyProjectPacTemplate}
                        >
                          {captureProfile?.templateLabel ?? "项目 PAC 模板"}
                        </button>
                        {captureProfile?.presets?.length ? (
                          <AppCustomSelect
                            className="capture-pac-preset-select"
                            variant="control"
                            value=""
                            showCheck={false}
                            disabled={capturing}
                            placeholder="全局预设…"
                            ariaLabel="全局 PAC 预设"
                            title="platform.config.yaml 中的全局 PAC 预设"
                            options={captureProfile.presets.map((p) => ({
                              value: p.hosts,
                              label: p.label,
                            }))}
                            onChange={(hosts) => {
                              if (hosts) applyPacPreset(hosts);
                            }}
                          />
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {(proxyStale || (capturing && proxyMode === "global")) && (
          <p className="capture-inline-alert">
            {proxyStale
              ? "系统代理仍开启但抓包未运行，客户端可能一直 Connecting。请点右上角「仅恢复上网」后完全退出客户端再开。"
              : "全局代理下部分客户端易白屏，建议停止后改用 PAC 或内嵌网页模式。"}
          </p>
        )}

        {controlMessage && !isCertInstallBannerMessage(controlMessage) ? (
          <CaptureControlMessage text={controlMessage} />
        ) : null}
        {embeddedMisconfigured && !capturing && (
          <p className="hint warn">
            当前为内嵌网页，且直连列表含 <code>{embeddedBlockedHosts.join(", ")}</code>，这些域名的 HTTPS <strong>不会进 mitm</strong>
            ，业务 API 无法出现在列表。请点「改用 PAC 抓包」或清空直连后只用 PAC 模式填写 API 域名。
          </p>
        )}
        {embeddedMisconfigured && !capturing && (
          <div className="capture-pac-fix-row">
            <button type="button" className="primary" onClick={applyProjectPacTemplate}>
              改用 PAC 抓包
            </button>
          </div>
        )}
        {capturing && embeddedMisconfigured && (
          <p className="hint warn">
            当前内嵌模式将 {embeddedBlockedHosts.join(", ")} 设为<strong>直连</strong>，业务 API 不会进列表。请「停止」后点「改用 PAC 抓包」重新开始。
          </p>
        )}
        {capturing && businessTxCount === 0 && !embeddedMisconfigured && (
          <p className="hint warn">
            尚无业务流量（仅自检或无请求经过 mitm）。请确认 PAC 含实际 API 主机、证书已装，并已重启目标应用后再次操作；可先关闭「仅 API」或用域名搜索。
          </p>
        )}
        {capturing && proxyMode !== "global" && (proxyMode === "pac" || proxyMode === "embedded") ? (
          <p className="hint capture-route-hint">
            路由：
            <code className="capture-pac-inline">{pacHosts.trim() || (proxyMode === "embedded" ? "广域 PAC" : "（未配置）")}</code>
          </p>
        ) : null}
      </section>

      <section className="card traffic-anchor capture-traffic-card">
        <div className="capture-traffic-toolbar">
          <div className="capture-traffic-toolbar-leading">
          <h3 className="card-title capture-traffic-title">
            抓包列表
            {activeSessionId && (
              <span className="hint" style={{ fontWeight: 400, marginLeft: 8 }}>
                {trafficSearch.trim()
                  ? `筛选 ${visibleTransactions.length} / 业务 ${businessTxCount}`
                  : apiOnlyFilter && apiMatchCount !== businessTxCount && !showingAllDespiteApiFilter
                    ? `API ${apiMatchCount} / 业务 ${businessTxCount}`
                    : showingAllDespiteApiFilter
                      ? `业务 ${businessTxCount} 条（未识别为 API，已全部显示）`
                      : `${businessTxCount} 条${probeTxCount ? `（${probeTxCount} 条自检已隐藏）` : ""}`}
              </span>
            )}
          </h3>
          <label className="check-label capture-api-only">
            <input
              type="checkbox"
              checked={apiOnlyFilter}
              onChange={(e) => setApiOnlyFilter(e.target.checked)}
            />
            仅 API
          </label>
          {capturing ? (
            <label className="check-label capture-api-only" title="开启后按时间倒序并固定在第 1 页展示最新请求">
              <input
                type="checkbox"
                checked={followLatest}
                onChange={(e) => {
                  const on = e.target.checked;
                  setFollowLatest(on);
                  setPendingNewTxCount(0);
                  visibleListLenRef.current = visibleTransactions.length;
                  if (on) setTxPage(1);
                }}
              />
              跟进最新
            </label>
          ) : null}
          {capturing && !followLatest && pendingNewTxCount > 0 ? (
            <button
              type="button"
              className="capture-new-tx-chip"
              onClick={() => {
                setTxPage(txPageCount);
                setPendingNewTxCount(0);
              }}
            >
              +{pendingNewTxCount} 条新请求 · 跳至末页
            </button>
          ) : null}
          </div>
          <div className="capture-traffic-search-wrap">
            <CaptureSearchIcon />
            <input
              className="text-input capture-traffic-search"
              placeholder="搜索 URL 或 Path"
              value={trafficSearch}
              onChange={(e) => {
                setTrafficSearch(e.target.value);
                setTxPage(1);
              }}
            />
          </div>
          <div className="capture-traffic-toolbar-actions">
          {sessions.length > 0 && !capturing ? (
            <CaptureSessionSelect
              sessions={sessions}
              value={selectedSession || activeSessionId}
              disabled={ingest.running}
              liveSessionId={lockedCaptureSessionId}
              onChange={(id) => {
                setSelectedSession(id);
                setSelectedTx(null);
                setDraftYaml("");
              }}
            />
          ) : null}
          <button
            type="button"
            className="capture-icon-btn capture-icon-btn--clear-session"
            disabled={busy || !activeSessionId}
            title="清空当前会话内全部流量记录（保留会话目录，不可恢复）"
            aria-label="清空当前会话记录"
            onClick={() => void onClearTransactions()}
          >
            <CaptureSweepIcon />
          </button>
          <button
            type="button"
            className="capture-icon-btn capture-icon-btn--delete-sessions"
            disabled={busy || !sessions.length}
            title="打开对话框，勾选并删除历史抓包会话（不可恢复）"
            aria-label="删除历史会话"
            onClick={() => onDeleteSessions()}
          >
            <CaptureTrashIcon />
          </button>
          {selectedCount > 0 ? (
            <>
              <span className="capture-selection-meta">已选 {selectedCount} 条</span>
              <button type="button" className="nav-btn" onClick={selectAllVisible}>
                全选当前列表
              </button>
              <button type="button" className="nav-btn" onClick={clearTxSelection}>
                取消选择
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || batchSaving || !activeSessionId}
                onClick={() => setBatchSaveOpen(true)}
              >
                保存到项目用例
              </button>
            </>
          ) : null}
          </div>
        </div>
        <div className="loading-host capture-traffic-table-host">
          <LoadingOverlay show={trafficLoading} label="加载流量…" />
          <table className="capture-traffic-table">
            <thead>
              <tr>
                <th className="capture-tx-check-col">
                  <input
                    type="checkbox"
                    aria-label="全选本页"
                    checked={allPageChecked}
                    disabled={!pageIds.length}
                    onChange={togglePageSelection}
                  />
                </th>
                <th>时间</th>
                <th>方法</th>
                <th>状态</th>
                <th>Path</th>
                <th>URL</th>
              </tr>
            </thead>
            <tbody>
            {pagedTransactions.map((t) => {
              const checked = checkedTxIds.has(t.id);
              return (
              <tr
                key={t.id}
                className={`clickable${checked ? " capture-tx-row--checked" : ""}`}
                onClick={() => void openTx(t.id)}
              >
                <td className="capture-tx-check-col" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`选择 ${t.method} ${t.path}`}
                    checked={checked}
                    onChange={() => toggleTxChecked(t.id)}
                  />
                </td>
                <td className="capture-time-cell">{formatCaptureListTime(t.captured_at)}</td>
                <td>
                  <span className={httpMethodBadgeClass(t.method)}>{t.method}</span>
                </td>
                <td>
                  {t.status ? (
                    <span className={`capture-status-pill capture-status-pill--${responseStatusTone(t.status)}`}>
                      {t.status}
                    </span>
                  ) : (
                    <span className="hint">—</span>
                  )}
                </td>
                <td className="capture-path-cell">{t.path}</td>
                <td className="url-cell">
                  <CaptureUrlCell url={t.url} onCopied={showDetailToast} />
                </td>
              </tr>
            );
            })}
            {!visibleTransactions.length && emptyListState && (
              <tr className="capture-empty-row">
                <td colSpan={6}>
                  <div
                    className={`capture-empty-state${emptyListState.action === "startCapture" ? " capture-empty-state--cta" : ""}`}
                  >
                    <div className="capture-empty-icon" aria-hidden>
                      ∅
                    </div>
                    <p className="capture-empty-title">{emptyListState.title}</p>
                    <p className="capture-empty-hint">{emptyListState.hint}</p>
                    {emptyListState.action === "clearSearch" && (
                      <button
                        type="button"
                        className="nav-btn"
                        onClick={() => setTrafficSearch("")}
                      >
                        清空搜索
                      </button>
                    )}
                    {emptyListState.action === "showAll" && (
                      <button
                        type="button"
                        className="nav-btn"
                        onClick={() => setApiOnlyFilter(false)}
                      >
                        显示全部流量
                      </button>
                    )}
                    {emptyListState.action === "startCapture" && !capturing ? (
                      <button
                        type="button"
                        className="primary capture-start-btn capture-empty-start-btn"
                        disabled={busy || !project}
                        onClick={() => void onStart()}
                      >
                        <CapturePlayIcon />
                        开始抓包
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            )}
            </tbody>
          </table>
        </div>
        {selectedCount === 0 ? (
          <p className="capture-table-foot-hint">勾选多条流量可批量保存为用例</p>
        ) : null}
        {visibleTransactions.length > 0 ? (
          <div className="capture-pagination-footer">
            <div className="capture-pagination">
              <span className="capture-pagination-meta">共 {visibleTransactions.length} 条</span>
              {visibleTransactions.length > TX_PAGE_SIZE ? (
                <div className="capture-pagination-controls">
                  <button
                    type="button"
                    className="nav-btn nav-btn--compact"
                    disabled={txPage <= 1}
                    onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </button>
                  <span className="capture-pagination-page">
                    第 {txPage} / {txPageCount} 页
                  </span>
                  <button
                    type="button"
                    className="nav-btn nav-btn--compact"
                    disabled={txPage >= txPageCount}
                    onClick={() => setTxPage((p) => Math.min(txPageCount, p + 1))}
                  >
                    下一页
                  </button>
                </div>
              ) : null}
              <span className="capture-pagination-size">每页 {TX_PAGE_SIZE} 条</span>
            </div>
          </div>
        ) : null}
      </section>

      {selectedTx && (
        <section className="card loading-host">
          <LoadingOverlay show={txDetailLoading} label="加载明细…" />
          <CaptureTxDetail
            tx={selectedTx}
            detailTab={detailTab}
            onTabChange={setDetailTab}
            draftCurl={draftCurl}
            draftYaml={draftYaml}
            onCopyCurl={() => void copyCurl()}
            onDownloadCurl={downloadCurl}
            onCopyResponseBody={() => void copyResponseBody()}
            onOpenInWorkbench={
              onOpenInWorkbench ? () => onOpenInWorkbench(captureTxToDraft(selectedTx)) : undefined
            }
            onSaveCase={() => setSaveCaseOpen(true)}
          />
        </section>
      )}

      {detailToast && (
        <div
          className={`app-toast${detailToast.includes("失败") ? " app-toast--err" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span className="app-toast-dot" aria-hidden />
          {detailToast}
        </div>
      )}

      <SaveCaseDialog
        open={saveCaseOpen && !!selectedTx}
        defaultProjectId={project || undefined}
        suggestedBaseUrl={
          selectedTx && typeof selectedTx === "object" && selectedTx !== null && "request" in selectedTx
            ? originFromUrl(
                String((selectedTx as { request?: { url?: string } }).request?.url ?? ""),
              )
            : undefined
        }
        defaultName={selectedTx ? captureTxToCaseMeta(selectedTx).defaultName : "captured-case"}
        yamlPreview={draftYaml}
        onCancel={() => setSaveCaseOpen(false)}
        onConfirm={({ projectId, caseName, addToSuite, suiteName }) => {
          void (async () => {
            if (!projectId || !draftYaml) return;
            if (selectedTx) await persistCaseAuthFromCapture(projectId, CAPTURE_CASE_ENV, selectedTx);
            const exists = await window.atp.projectCaseExists(projectId, caseName);
            setSaveCaseOpen(false);
            if (exists) {
              setPendingCaseOverwrite({ projectId, caseName, addToSuite, suiteName, yaml: draftYaml });
              return;
            }
            const res = await window.atp.saveProjectCase(projectId, caseName, draftYaml, {
              addToSuite: addToSuite ? suiteName : undefined,
            });
            if (!res.ok) {
              showDetailToast(res.error ?? "保存失败");
              return;
            }
            showDetailToast(`已保存 ${res.relativePath}`);
            onCaseSaved?.();
          })();
        }}
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
          if (!pending?.projectId) return;
          void (async () => {
            if (selectedTx) await persistCaseAuthFromCapture(pending.projectId, CAPTURE_CASE_ENV, selectedTx);
            const res = await window.atp.saveProjectCase(pending.projectId, pending.caseName, pending.yaml, {
              addToSuite: pending.addToSuite ? pending.suiteName : undefined,
              overwrite: true,
            });
            if (!res.ok) {
              showDetailToast(res.error ?? "覆盖失败");
              return;
            }
            showDetailToast(`已覆盖 ${res.relativePath}`);
            onCaseSaved?.();
          })();
        }}
      />

      <ConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ""}
        message={pendingConfirm?.message ?? ""}
        confirmLabel={pendingConfirm?.confirmLabel}
        danger={pendingConfirm?.danger}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          const action = pendingConfirm?.run;
          setPendingConfirm(null);
          void action?.();
        }}
      />

      <CaptureSessionsDialog
        open={sessionsDeleteOpen}
        sessions={sessions}
        lockedSessionId={lockedCaptureSessionId}
        initialSelected={
          activeSessionId && activeSessionId !== lockedCaptureSessionId ? [activeSessionId] : []
        }
        busy={busy}
        onCancel={() => setSessionsDeleteOpen(false)}
        onConfirm={(ids) => void runDeleteSessions(ids)}
      />

      <BatchSaveCasesDialog
        open={batchSaveOpen}
        rows={batchCaseRows}
        saving={batchSaving}
        defaultProjectId={project || undefined}
        onCancel={() => !batchSaving && setBatchSaveOpen(false)}
        onConfirm={(opts) => void runBatchSave(opts)}
      />
    </>
  );
}

const TECHNICAL_MSG =
  /mitm|mitmdump|venv|Scripts|未运行|退出|pip install|8888|\.py/i;

function looksLikePathSegment(segment: string): boolean {
  return /[\\/]|mitmdump|\.py|venv|Scripts/i.test(segment);
}

function isTechnicalCaptureSegment(seg: string): boolean {
  if (/^会话\s/u.test(seg)) return true;
  if (/^Ingest\s/i.test(seg)) return true;
  if (/^MITM\s/i.test(seg) && /[\d.:]/i.test(seg)) return true;
  if (/127\.0\.0\.1|localhost|WinHTTP|ProxyEnable|Registry|proxy server/i.test(seg)) return true;
  return looksLikePathSegment(seg);
}

function humanCaptureSummary(segments: string[], mitmDown: boolean): string {
  if (mitmDown) return "MITM 代理未运行，无法拦截 HTTPS。";
  const human = segments.filter((s) => !isTechnicalCaptureSegment(s));
  const informative = human.find((s) => /真实链路|自检|警告|系统代理|已写入|请/.test(s));
  if (informative) return informative;
  if (human.length) return human[human.length - 1];
  return "抓包服务已启动，可在目标客户端访问业务站点。";
}

function CaptureControlMessage({ text }: { text: string }) {
  const warn = TECHNICAL_MSG.test(text) || /警告|失败|未开启/i.test(text);
  const mitmDown = /MITM\s*未运行/i.test(text);
  const displayText = mitmDown ? text.replace(/^MITM\s*未运行[:：]\s*/i, "") : text;
  const segments = displayText
    .split(/[·;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const bodySegments = mitmDown ? segments.filter((s) => !/^MITM\s*未运行\.?$/i.test(s)) : segments;
  const technical = bodySegments.filter(isTechnicalCaptureSegment);
  const summary = humanCaptureSummary(bodySegments, mitmDown);

  return (
    <div
      className={`capture-control-alert capture-control-alert--compact${warn ? " capture-control-alert--warn" : " capture-control-alert--info"}`}
      role="status"
    >
      {mitmDown ? <p className="capture-control-alert-lead">MITM 未运行</p> : null}
      <p className="capture-control-alert-summary">{summary}</p>
      {technical.length > 0 || bodySegments.length > 1 ? (
        <details className="capture-control-tech-details">
          <summary>查看技术详情</summary>
          <div className="capture-control-alert-body">
            {bodySegments.map((seg, i) => (
              <p key={`${i}-${seg.slice(0, 24)}`} className="capture-control-tech-line">
                {looksLikePathSegment(seg) ? <code>{seg}</code> : seg}
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function CaptureSessionSelect({
  sessions,
  value,
  disabled,
  liveSessionId,
  onChange,
}: {
  sessions: Session[];
  value: string;
  disabled?: boolean;
  liveSessionId: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = sessions.find((s) => s.id === value);

  const pickerSessions = useMemo(() => {
    const copy = [...sessions];
    copy.sort((a, b) => {
      const ta = a.started_at || a.id;
      const tb = b.started_at || b.id;
      return ta < tb ? 1 : ta > tb ? -1 : 0;
    });
    return copy.filter((s) => s.transactionCount > 0 || s.id === value);
  }, [sessions, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const isLive = Boolean(liveSessionId && value && liveSessionId === value);
  const triggerLabel = selected
    ? isLive
      ? `当前 · ${formatSessionPickerShort(selected.id)} · ${selected.transactionCount} 条`
      : `${formatSessionPickerShort(selected.id)} · ${selected.transactionCount} 条`
    : "选择会话";

  return (
    <div className="capture-session-picker" ref={rootRef}>
      <button
        type="button"
        className="capture-session-picker-trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="切换历史抓包会话"
        title="切换历史抓包会话"
        onClick={() => setOpen((v) => !v)}
      >
        {isLive ? (
          <span className="capture-session-picker-live-dot" aria-hidden />
        ) : (
          <CaptureFolderIcon />
        )}
        <span className="capture-session-picker-trigger-text">{triggerLabel}</span>
        <span className="capture-session-picker-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="capture-session-picker-panel" role="listbox" aria-label="历史会话">
          {pickerSessions.map((s) => {
            const active = s.id === value;
            const empty = s.transactionCount === 0;
            return (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`capture-session-picker-option${active ? " capture-session-picker-option--active" : ""}${empty ? " capture-session-picker-option--empty" : ""}`}
                onClick={() => {
                  onChange(s.id);
                  setOpen(false);
                }}
              >
                <span className="capture-session-picker-time">{formatCaptureSessionHeadline(s.id)}</span>
                <span className="capture-session-picker-sep" aria-hidden>
                  |
                </span>
                <span className={`capture-session-picker-count${empty ? " is-empty" : ""}`}>
                  {s.transactionCount} 条
                </span>
                {active ? (
                  <span className="capture-session-picker-check" aria-hidden>
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CaptureSessionSummaryRow({
  sessionId,
  capturing,
  compact,
  onCopied,
}: {
  sessionId: string;
  capturing: boolean;
  compact?: boolean;
  onCopied: (msg: string) => void;
}) {
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      onCopied("已复制会话 ID");
    } catch {
      onCopied("复制失败");
    }
  };
  return (
    <div className={`capture-session-summary${compact ? " capture-session-summary--compact" : ""}`}>
      {compact ? null : (
        <span className="capture-session-summary-label">{capturing ? "进行中会话" : "当前会话"}</span>
      )}
      <span className="capture-session-summary-time">{formatCaptureSessionHeadline(sessionId)}</span>
      <span className="capture-session-id-chip" title={sessionId}>
        <code>{captureSessionIdHash(sessionId)}</code>
        <button
          type="button"
          className="capture-session-id-chip-copy"
          title="复制会话 ID"
          aria-label="复制会话 ID"
          onClick={() => void onCopy()}
        >
          <CaptureCopyIcon />
        </button>
      </span>
    </div>
  );
}

function CaptureUrlCell({
  url,
  onCopied,
}: {
  url: string;
  onCopied: (msg: string) => void;
}) {
  const onCopy = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      onCopied("已复制 URL");
    } catch {
      onCopied("复制失败");
    }
  };
  return (
    <span className="capture-url-cell-inner" title={url}>
      <span className="capture-url-text">{url}</span>
      <button type="button" className="capture-url-copy" title="复制 URL" aria-label="复制 URL" onClick={onCopy}>
        <CaptureCopyIcon />
      </button>
    </span>
  );
}

function CaptureStatusBadge({
  running,
  onLabel,
  offLabel,
}: {
  running: boolean;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <span
      className={`capture-status-badge${running ? " capture-status-badge--on" : " capture-status-badge--off"}`}
    >
      <span className="capture-status-badge-dot" aria-hidden />
      {running ? onLabel : offLabel}
    </span>
  );
}

function CaptureRestoreNetIcon() {
  return (
    <svg className="capture-restore-net-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M8 1.75a6.25 6.25 0 1 1 0 12.5A6.18 6.18 0 0 1 2.9 9h1.5a4.75 4.75 0 1 0 1.02-3.07H6V3.5h4v4H6V5.63a4.88 4.88 0 0 0-.15-.05 4.75 4.75 0 1 0 3.15 8.42h.01V12H7v4h4v-4H9.57A6.24 6.24 0 0 1 8 14.75Z"
      />
    </svg>
  );
}

function CaptureStopIcon() {
  return (
    <svg className="capture-btn-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      <rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1" fill="currentColor" />
    </svg>
  );
}

function CaptureSearchIcon() {
  return (
    <svg className="capture-search-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 1.25a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Zm4.36 7.39 2.45 2.45a.63.63 0 1 1-.89.89l-2.45-2.45a.63.63 0 0 1 .89-.89Z"
      />
    </svg>
  );
}

function CaptureCopyIcon() {
  return (
    <svg className="capture-url-copy-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M5.5 2.75A.75.75 0 0 1 6.25 2h5.5a.75.75 0 0 1 .75.75v9.5A.75.75 0 0 1 11.75 13h-5.5A.75.75 0 0 1 5.5 12.25v-9.5Zm1.5 1.25v7.75h4v-7.75h-4ZM3.75 5.25A.75.75 0 0 0 3 6v6.75A1.75 1.75 0 0 0 4.75 14.5h5.5v-1.25h-5a.5.5 0 0 1-.5-.5V5.25Z"
      />
    </svg>
  );
}

function CapturePlayIcon() {
  return (
    <svg className="capture-btn-icon capture-btn-icon--play" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path fill="currentColor" d="M5.5 3.2a.75.75 0 0 1 1.14-.64l5.5 4.3a.75.75 0 0 1 0 1.28l-5.5 4.3A.75.75 0 0 1 5.5 11V3.2Z" />
    </svg>
  );
}

function CaptureShieldIcon() {
  return (
    <svg className="capture-btn-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M8 1.5 3.25 3.5v4.1c0 3.05 2.02 5.9 4.75 6.85 2.73-.95 4.75-3.8 4.75-6.85v-4.1L8 1.5Zm0 1.24 3.75 1.65v3.21c0 2.46-1.62 4.75-3.75 5.5-2.13-.75-3.75-3.04-3.75-5.5V4.39L8 2.74Z"
      />
    </svg>
  );
}

function CaptureSweepIcon() {
  return (
    <svg className="capture-toolbar-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M2 4.25h8.5v1H2v-1ZM2 7.25h6v1H2v-1ZM2 10.25h4v1H2v-1Z"
      />
      <path
        fill="currentColor"
        d="m11.2 9.1 3.2 3.2-1.4 1.4-3.2-3.2 1.4-1.4Zm.9-1.3 1.7-1.7a.75.75 0 0 1 1.06 0l2 2a.75.75 0 0 1 0 1.06l-1.7 1.7-3.06-3.06Z"
      />
    </svg>
  );
}

function CaptureFolderIcon() {
  return (
    <svg className="capture-session-folder-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M2.5 4.25A1.25 1.25 0 0 1 3.75 3h2.9l1.1 1.25h4.5A1.25 1.25 0 0 1 13.25 5.5v7A1.25 1.25 0 0 1 12 13.75H4A1.25 1.25 0 0 1 2.75 12.5v-8.25Z"
      />
    </svg>
  );
}

function CaptureTrashIcon() {
  return (
    <svg className="capture-toolbar-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M5.5 1.75a.75.75 0 0 1 .75-.75H9.75a.75.75 0 0 1 .75.75V3h3.25a.75.75 0 0 1 0 1.5h-.38l-.83 9.2A1.5 1.5 0 0 1 11.08 15H4.92a1.5 1.5 0 0 1-1.49-1.3l-.83-9.2H2.5a.75.75 0 0 1 0-1.5H5.5V1.75Zm2 .75v.5h1.5V2.5H7.5ZM4.5 4.5l.78 8.6a.25.25 0 0 0 .24.22h5.16a.25.25 0 0 0 .24-.22l.78-8.6H4.5Z"
      />
    </svg>
  );
}

function CaptureTxDetail({
  tx,
  detailTab,
  onTabChange,
  draftCurl,
  draftYaml,
  onCopyCurl,
  onDownloadCurl,
  onCopyResponseBody,
  onOpenInWorkbench,
  onSaveCase,
}: {
  tx: unknown;
  detailTab: CaptureDetailTab;
  onTabChange: (tab: CaptureDetailTab) => void;
  draftCurl: string;
  draftYaml: string;
  onCopyCurl: () => void;
  onDownloadCurl: () => void;
  onCopyResponseBody: () => void;
  onOpenInWorkbench?: () => void;
  onSaveCase: () => void;
}) {
  const parsed = asCaptureTransaction(tx);
  const resp = parsed?.response;
  const status = resp?.status ?? 0;
  const durationMs = resp?.duration_ms;
  const ws = parsed?.websocket;
  const respCt = pickContentType(resp?.headers);
  const respBytes = estimateBodyBytes(ws?.body ?? resp?.body);
  const [payloadView, setPayloadView] = useState<"body" | "headers">("body");

  useEffect(() => {
    setPayloadView("body");
  }, [parsed?.id]);

  const tabs: Array<{ id: CaptureDetailTab; label: string }> = [
    { id: "response", label: "响应" },
    { id: "request", label: "请求" },
    { id: "curl", label: "cURL" },
    { id: "yaml", label: "用例 YAML" },
    { id: "raw", label: "完整 JSON" },
  ];

  return (
    <div className="capture-detail-card">
      <div className="capture-detail-toolbar">
        <div className="capture-detail-head">
          <h3 className="capture-detail-title">交易明细</h3>
          <div className="capture-meta-chips">
            {status > 0 ? (
              <>
                <span
                  className={`capture-meta-chip capture-meta-chip--${httpStatusTone(status, status >= 200 && status < 300)}`}
                >
                  HTTP {status}
                </span>
                {durationMs != null ? (
                  <span className="capture-meta-chip capture-meta-chip--muted">耗时 {Math.round(durationMs)} ms</span>
                ) : null}
                {respCt ? <span className="capture-meta-chip capture-meta-chip--muted">{respCt}</span> : null}
                {respBytes != null && detailTab === "response" ? (
                  <span className="capture-meta-chip capture-meta-chip--muted">{respBytes} B</span>
                ) : null}
              </>
            ) : (
              <span className="hint">未记录响应</span>
            )}
          </div>
        </div>
        <div className="capture-detail-actions">
          {detailTab === "response" ? (
            <button type="button" className="nav-btn nav-btn--compact" onClick={onCopyResponseBody}>
              复制 Body
            </button>
          ) : null}
          <button type="button" className="nav-btn nav-btn--compact" onClick={onCopyCurl}>
            复制 cURL
          </button>
          <button type="button" className="nav-btn nav-btn--compact" onClick={onDownloadCurl}>
            下载脚本
          </button>
          {onOpenInWorkbench ? (
            <button type="button" className="primary nav-btn--compact" onClick={onOpenInWorkbench}>
              在工作台打开
            </button>
          ) : null}
          <button type="button" className="nav-btn nav-btn--compact" onClick={onSaveCase}>
            保存为用例
          </button>
        </div>
      </div>

      <div className="capture-detail-tabs" role="tablist" aria-label="明细类型">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={detailTab === t.id}
            className={`capture-detail-tab${detailTab === t.id ? " capture-detail-tab--active" : ""}`}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="capture-detail-body">
        {detailTab === "response" && (
          <CapturePayloadPane
            headers={resp?.headers}
            body={resp?.body}
            ws={ws}
            payloadView={payloadView}
            onPayloadView={setPayloadView}
          />
        )}

        {detailTab === "request" && (
          <CapturePayloadPane
            method={parsed?.request?.method}
            url={parsed?.request?.url}
            headers={parsed?.request?.headers}
            body={parsed?.request?.body}
            payloadView={payloadView}
            onPayloadView={setPayloadView}
          />
        )}

        {detailTab === "curl" && <pre className="capture-scroll-block capture-scroll-block--curl">{draftCurl}</pre>}

        {detailTab === "yaml" && <DraftYaml draft={draftYaml} />}

        {detailTab === "raw" && (
          <pre className="capture-scroll-block capture-scroll-block--mono">{JSON.stringify(tx, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}

function CaptureHeaderTable({ headers }: { headers?: Record<string, string> }) {
  const rows = headerEntries(headers);
  if (!rows.length) {
    return <p className="capture-empty-hint">（无 Header）</p>;
  }
  return (
    <div className="capture-headers-table-wrap">
      <table className="capture-headers-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CapturePayloadPane({
  method,
  url,
  headers,
  body,
  ws,
  payloadView,
  onPayloadView,
}: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  ws?: { from_client?: boolean; type?: string; body?: string };
  payloadView: "body" | "headers";
  onPayloadView: (v: "body" | "headers") => void;
}) {
  const contentType = pickContentType(headers);
  const imageMime = sniffImageMime(body, headers);
  const bodyText = ws?.body ?? formatCaptureBodyText(body, headers);
  const imageSrc = !ws?.body ? captureBodyImageSrc(headers, body) : null;

  return (
    <div className="capture-payload-pane">
      {url ? (
        <div className="capture-req-banner">
          <span className={`method-tag method-${(method ?? "GET").toLowerCase()}`}>{method ?? "GET"}</span>
          <span className="capture-req-url" title={url}>
            {url}
          </span>
        </div>
      ) : null}
      {ws ? (
        <p className="hint capture-ws-note">
          WebSocket · {ws.from_client ? "上行" : "下行"} · {ws.type ?? "text"}
        </p>
      ) : null}

      <div className="capture-subtabs" role="tablist" aria-label="报文">
        <button
          type="button"
          role="tab"
          aria-selected={payloadView === "body"}
          className={`capture-subtab${payloadView === "body" ? " capture-subtab--active" : ""}`}
          onClick={() => onPayloadView("body")}
        >
          Body
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={payloadView === "headers"}
          className={`capture-subtab${payloadView === "headers" ? " capture-subtab--active" : ""}`}
          onClick={() => onPayloadView("headers")}
        >
          Headers
          <span className="capture-subtab-count">{headerEntries(headers).length}</span>
        </button>
        {contentType ? <span className="capture-subtabs-ct">{contentType}</span> : null}
      </div>

      {payloadView === "headers" ? (
        <CaptureHeaderTable headers={headers} />
      ) : imageSrc ? (
        <div className="capture-image-preview">
          <img src={imageSrc} alt={contentType ?? imageMime ?? "响应图片"} />
          <p className="hint">图片响应（{contentType ?? imageMime}）</p>
        </div>
      ) : imageMime ? (
        <p className="capture-empty-hint">{bodyText}</p>
      ) : (
        <pre className="capture-scroll-block capture-scroll-block--mono">{bodyText}</pre>
      )}
    </div>
  );
}

function DraftYaml({ draft }: { draft: string }) {
  return (
    <div>
      <h4 className="sub-title">用例草案（YAML）</h4>
      <pre>{draft}</pre>
    </div>
  );
}