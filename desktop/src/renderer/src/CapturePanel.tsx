import { useCallback, useEffect, useMemo, useState } from "react";

type CaptureProxyMode = "pac" | "global" | "embedded";

import ConfirmDialog from "./ConfirmDialog";
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
import { embeddedBypassBlocksApiCapture, NANCAI_TERMINAL_PAC_HOSTS } from "./capturePacHints";
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

const PAC_HOSTS_STORAGE = "atp-capture-pac-hosts";
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
  const [pacHosts, setPacHosts] = useState(() => {
    try {
      const saved = localStorage.getItem(PAC_HOSTS_STORAGE);
      if (saved?.trim()) return saved;
    } catch {
      /* ignore */
    }
    return "";
  });
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
  const [trafficSearch, setTrafficSearch] = useState("");
  const [txPage, setTxPage] = useState(1);
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
  useEffect(() => {
    try {
      localStorage.setItem(PAC_HOSTS_STORAGE, pacHosts);
    } catch {
      /* ignore */
    }
  }, [pacHosts]);

  const capturing = ingest.running || mitm.running;
  const embeddedMisconfigured = useMemo(
    () => proxyMode === "embedded" && embeddedBypassBlocksApiCapture(pacHosts).length > 0,
    [proxyMode, pacHosts],
  );
  const embeddedBlockedHosts = useMemo(
    () => (embeddedMisconfigured ? embeddedBypassBlocksApiCapture(pacHosts) : []),
    [embeddedMisconfigured, pacHosts],
  );
  const applyNancaiPacTemplate = () => {
    setProxyMode("pac");
    setPacHosts(NANCAI_TERMINAL_PAC_HOSTS);
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
    return [...source].sort(compareCapturedAtDesc);
  }, [transactions, apiOnlyFilter, trafficSearch, withoutProbeTransactions]);

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
            "开始抓包时有一条 www.baidu.com 链路自检（验证 MITM→Ingest），不会出现在列表中。请用 Chrome 或已重启的南财访问目标站点；列表约每 2 秒刷新。",
          action: null,
        };
      }
      return {
        title: "等待流量",
        hint: "用 Chrome 访问目标站点（HTTPS 需已安装证书并重开浏览器）。列表约每 2 秒刷新。",
        action: null,
      };
    }
    if (!activeSessionId) {
      return {
        title: "暂无抓包记录",
        hint: "点击「开始抓包」后访问网页，或从历史会话下拉框选择已有会话。",
        action: null,
      };
    }
    return {
      title: "本会话暂无记录",
      hint: "该会话未写入流量，或已被「清空列表」。可重新开始抓包。",
      action: null,
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
  }, [activeSessionId, apiOnlyFilter]);

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
        setTransactions(Array.isArray(txs) ? txs : []);
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

  const runQuickCaptureStart = async () => {
    if (!project) return;
    setBusy(true);
    setMessage("");
    const res = await window.atp.quickCaptureStart({
      project,
      label,
      hostFilter: proxyMode === "pac" || proxyMode === "embedded" ? pacHosts.trim() : "",
      sessionId: undefined,
      setSystemProxy: true,
      proxyMode,
    });
    setBusy(false);
    if (!res.ok) {
      setMessage(res.error ?? "启动失败");
      const d = await window.atp.captureDiagnose(8888);
      if (d.issues.length) setMessage((m) => `${m} · ${d.issues.join("；")}`);
      return;
    }
    if (res.sessionId) setSelectedSession(res.sessionId);
    setMessage(res.messages.join(" · "));
    await refreshStatus();
    await refreshIndex();
  };

  const onStart = async () => {
    if (!project) return;
    if (proxyMode === "pac" && !pacHosts.trim()) {
      setMessage("PAC 模式下请填写要快照的 API 域名（逗号分隔）");
      return;
    }
    if (!mitmAvail) {
      setMessage("未安装 mitmproxy，请在仓库根目录 pip install -r requirements-capture.txt");
      return;
    }
    if (embeddedMisconfigured) {
      const blocked = embeddedBlockedHosts.join(", ");
      setPendingConfirm({
        title: "直连列表会挡住南财 API",
        message: `内嵌网页模式下，「直连域名」不经 mitm。当前含 ${blocked}，南财终端请求会直连，列表通常为空。建议点取消后改用「PAC（按域名）」并填入 API 主机；若仅抓 WebView 外链可仍继续。`,
        confirmLabel: "仍要开始",
        run: () => void runQuickCaptureStart(),
      });
      return;
    }
    await runQuickCaptureStart();
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

  return (
    <>
      <div className="module-head-row capture-module-head">
        <h2 className="page-head">抓包</h2>
        <span className="module-context-chip" title={`项目 ID：${project}`}>
          {projectName || project}
        </span>
      </div>

      <section className="card">
        <h3 className="card-title">控制</h3>
        <div className="toolbar capture-control-toolbar">
          <input
            className="text-input"
            style={{ flex: 1, maxWidth: 220 }}
            placeholder="备注（可选）"
            value={label}
            disabled={capturing}
            onChange={(e) => setLabel(e.target.value)}
          />
          <select
            className="text-input capture-proxy-mode"
            value={proxyMode}
            disabled={capturing}
            title="PAC 仅代理填写的 API 域名，其它流量直连"
            onChange={(e) => setProxyMode(e.target.value as CaptureProxyMode)}
            aria-label="代理模式"
          >
            <option value="pac">PAC（按域名）</option>
            <option value="embedded">内嵌网页（广域 PAC）</option>
            <option value="global">全局代理</option>
          </select>
          {!capturing ? (
            <button type="button" className="nav-btn" disabled={busy} onClick={() => void onInstallCa()}>
              安装证书
            </button>
          ) : null}
          {!capturing ? (
            <button type="button" className="primary" disabled={busy || !project} onClick={() => void onStart()}>
              开始抓包
            </button>
          ) : (
            <button type="button" className="primary" disabled={busy} onClick={() => void onStop()}>
              停止并恢复上网
            </button>
          )}
          {proxyStale && (
            <button type="button" className="nav-btn" disabled={busy} onClick={() => void onRestoreNetwork()}>
              恢复上网
            </button>
          )}
        </div>

        <div className="status-strip">
          <span className={capturing ? "dot-live" : ""} />
          Ingest {ingest.running ? "开" : "关"}
          {" · "}
          MITM {mitm.running ? "开" : "关"}
          {" · "}
          代理{" "}
          {sysProxy.enabled
            ? sysProxy.autoConfigUrl
              ? "PAC"
              : sysProxy.server || "开"
            : "关"}
          {activeSessionId && (
            <>
              {" · "}
              会话 <code>{activeSessionId.slice(0, 20)}…</code>
            </>
          )}
        </div>

        {(proxyStale || (capturing && proxyMode === "global")) && (
          <p className="hint warn">
            {proxyStale
              ? "系统代理仍开着但抓包未运行。部分桌面客户端可能一直显示 Connecting——请先点「仅恢复上网」，再完全退出客户端后重开。"
              : "全局代理下部分桌面客户端首页易白屏/Connecting。建议停止后改用 PAC 或内嵌网页模式。"}
          </p>
        )}
        <div className="capture-recovery-row">
          <button
            type="button"
            className={`nav-btn${proxyStale ? " capture-recovery-btn--urgent" : ""}`}
            disabled={busy}
            onClick={() => void onRestoreNetwork()}
          >
            仅恢复上网（白屏 / Connecting 时点此项）
          </button>
        </div>

        {message && <p className="hint">{message}</p>}

        {!capturing && (
          <p className="hint">
            南财等<strong>桌面终端</strong>：请用 <strong>PAC（按域名）</strong>，把 API 主机填在下栏（不要放在内嵌模式的「直连」）。安装证书 → 开始抓包 →
            <strong>完全退出</strong>终端再打开。慎用「全局代理」（易白屏）。
          </p>
        )}
        {embeddedMisconfigured && !capturing && (
          <p className="hint warn">
            当前为内嵌网页，且直连列表含 <code>{embeddedBlockedHosts.join(", ")}</code>，这些域名的 HTTPS <strong>不会进 mitm</strong>
            ，南财 API 无法出现在列表。请点「改用南财 PAC 抓包」或清空直连后只用 PAC 模式填写 API 域名。
          </p>
        )}
        {(proxyMode === "pac" || proxyMode === "embedded") && !capturing && (
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
                <button
                  type="button"
                  className="nav-btn nav-btn--compact"
                  disabled={capturing}
                  title="填入南财常见 API 主机并切换到 PAC 模式"
                  onClick={applyNancaiPacTemplate}
                >
                  南财 PAC 模板
                </button>
              )}
            </div>
          </div>
        )}
        {embeddedMisconfigured && !capturing && (
          <div className="capture-pac-fix-row">
            <button type="button" className="primary" onClick={applyNancaiPacTemplate}>
              改用南财 PAC 抓包
            </button>
          </div>
        )}
        {proxyMode === "embedded" && !capturing && (
          <p className="hint capture-proxy-hint">
            <strong>内嵌网页：</strong>先点「开始抓包」→ 再启动目标应用 → 打开内嵌 H5/WebView 页面。广域 PAC 会将公网
            HTTP(S) 经 mitm（内网与本机直连）。
          </p>
        )}
        {capturing && (proxyMode === "pac" || proxyMode === "embedded") && (
          <p className="hint capture-proxy-hint">
            ① 已安装 MITM 证书 ② 抓包开始后<strong>完全退出</strong>目标应用再打开 ③ 在应用内触发请求。若仍无记录：试「内嵌网页」模式、关「仅
            API」或按域名搜索。SSL Pinning 无法 mitm。
          </p>
        )}
        {capturing && embeddedMisconfigured && (
          <p className="hint warn">
            当前内嵌模式将 {embeddedBlockedHosts.join(", ")} 设为<strong>直连</strong>，南财 API 不会进列表。请「停止」后点「改用南财 PAC 抓包」重新开始。
          </p>
        )}
        {capturing && businessTxCount === 0 && !embeddedMisconfigured && (
          <p className="hint warn">
            尚无业务流量（仅自检或无请求经过 mitm）。请确认 PAC 含实际 API 主机、证书已装，并已重启目标应用后再次操作；可先关闭「仅 API」或用域名搜索。
          </p>
        )}
        {capturing && (
          <p className="hint">
            {proxyMode === "global" ? (
              <>
                当前为<strong>全局代理</strong>：若客户端白屏，请点「停止」后改用 <strong>内嵌网页</strong> 或 <strong>PAC</strong>。
              </>
            ) : proxyMode === "embedded" ? (
              <>
                当前为<strong>内嵌网页广域 PAC</strong>
                {pacHosts.trim() ? (
                  <>
                    ，直连：<code className="capture-pac-inline">{pacHosts}</code>
                  </>
                ) : (
                  <>（公网 HTTP(S) 均经 mitm）</>
                )}
              </>
            ) : (
              <>
                当前 PAC 路由：
                <code className="capture-pac-inline">{pacHosts.trim() || "（未配置）"}</code>
              </>
            )}
            {" "}
            浏览器抓包需先安装证书；可关「仅 API」或搜索域名过滤。
          </p>
        )}
      </section>

      <section className="card traffic-anchor">
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <h3 className="card-title" style={{ margin: 0, flex: 1 }}>
            流量列表
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
          <input
            className="text-input capture-traffic-search"
            placeholder="搜索 URL / 域名"
            value={trafficSearch}
            onChange={(e) => {
              setTrafficSearch(e.target.value);
              setTxPage(1);
            }}
          />
          {sessions.length > 0 && !capturing && (
            <select
              className="session-select"
              value={selectedSession || activeSessionId}
              disabled={ingest.running}
              onChange={(e) => {
                setSelectedSession(e.target.value);
                setSelectedTx(null);
                setDraftYaml("");
              }}
              title={ingest.running ? "抓包中固定为当前会话" : "切换历史会话"}
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {ingest.running && ingest.sessionId === s.id ? "当前 · " : "历史 · "}
                  {s.transactionCount} 条 · {s.id.slice(0, 18)}…
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="nav-btn"
            disabled={busy || !activeSessionId}
            title="仅清空列表，保留会话"
            onClick={() => void onClearTransactions()}
          >
            清空列表
          </button>
          <button
            type="button"
            className="nav-btn"
            disabled={busy || !sessions.length}
            title="勾选并删除多个历史会话"
            onClick={() => onDeleteSessions()}
          >
            删除会话…
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
          ) : (
            <span className="hint capture-select-hint">勾选多条流量可批量保存为用例</span>
          )}
        </div>
        <div className="loading-host capture-traffic-table-host">
          <LoadingOverlay show={trafficLoading} label="加载流量…" />
          <table>
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
                <td>{t.captured_at}</td>
                <td>{t.method}</td>
                <td>
                  {t.status ? (
                    <span className={`capture-status-pill capture-status-pill--${responseStatusTone(t.status)}`}>
                      {t.status}
                    </span>
                  ) : (
                    <span className="hint">—</span>
                  )}
                </td>
                <td>{t.path}</td>
                <td className="url-cell">{t.url}</td>
              </tr>
            );
            })}
            {!visibleTransactions.length && emptyListState && (
              <tr className="capture-empty-row">
                <td colSpan={6}>
                  <div className="capture-empty-state">
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
                  </div>
                </td>
              </tr>
            )}
            </tbody>
          </table>
        </div>
        {visibleTransactions.length > TX_PAGE_SIZE && (
          <div className="pagination">
            <button
              type="button"
              className="nav-btn"
              disabled={txPage <= 1}
              onClick={() => setTxPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </button>
            <span className="pagination-info">
              第 {txPage} / {txPageCount} 页 · 每页 {TX_PAGE_SIZE} 条 · 共 {visibleTransactions.length} 条
            </span>
            <button
              type="button"
              className="nav-btn"
              disabled={txPage >= txPageCount}
              onClick={() => setTxPage((p) => Math.min(txPageCount, p + 1))}
            >
              下一页
            </button>
          </div>
        )}
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