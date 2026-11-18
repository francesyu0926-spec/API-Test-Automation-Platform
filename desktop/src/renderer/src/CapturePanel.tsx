import { useCallback, useEffect, useMemo, useState } from "react";

import ConfirmDialog from "./ConfirmDialog";
import CaptureSessionsDialog from "./CaptureSessionsDialog";
import LoadingOverlay from "./LoadingOverlay";
import SaveCaseDialog from "./SaveCaseDialog";
import { captureTxToDraft } from "./apiWorkbenchModel";
import { captureTxToCaseMeta, captureTxToCaseYaml } from "./caseYaml";
import { transactionToCurl } from "./captureCurl";
import { filterTransactions } from "./captureFilters";
import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";

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

type Props = {
  projects: { id: string; name: string }[];
  project: string;
  onProject: (id: string) => void;
  onOpenInWorkbench?: (draft: WorkbenchDraft) => void;
  onCaseSaved?: () => void;
};

export default function CapturePanel({ projects, project, onProject, onOpenInWorkbench, onCaseSaved }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [label, setLabel] = useState("");
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
  const capturing = ingest.running || mitm.running;
  const lockedCaptureSessionId =
    ingest.running && ingest.sessionId && ingest.project === project ? ingest.sessionId : null;
  const activeSessionId =
    ingest.running && ingest.sessionId ? ingest.sessionId : selectedSession;

  const visibleTransactions = useMemo(() => {
    const q = trafficSearch.trim().toLowerCase();
    const source = q
      ? transactions.filter(
          (t) =>
            t.url.toLowerCase().includes(q) ||
            t.path.toLowerCase().includes(q) ||
            t.method.toLowerCase().includes(q),
        )
      : apiOnlyFilter
        ? (() => {
            const apiRows = filterTransactions(transactions, true);
            if (!apiRows.length && transactions.length) return transactions;
            return apiRows;
          })()
        : transactions;
    return source;
  }, [transactions, apiOnlyFilter, trafficSearch]);

  const apiMatchCount = useMemo(
    () => filterTransactions(transactions, true).length,
    [transactions],
  );
  const showingAllDespiteApiFilter =
    apiOnlyFilter &&
    !trafficSearch.trim() &&
    transactions.length > 0 &&
    apiMatchCount === 0;

  const emptyListState = useMemo(() => {
    if (visibleTransactions.length > 0) return null;
    const q = trafficSearch.trim();
    if (q) {
      return {
        title: "无匹配流量",
        hint: `没有包含「${q}」的记录。可清空搜索，或关闭「仅 API」查看全部 ${transactions.length} 条。`,
        action: "clearSearch" as const,
      };
    }
    if (capturing) {
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
    apiOnlyFilter,
    apiMatchCount,
    capturing,
    activeSessionId,
  ]);

  const txPageCount = Math.max(1, Math.ceil(visibleTransactions.length / TX_PAGE_SIZE) || 1);
  const pagedTransactions = useMemo(() => {
    const start = (txPage - 1) * TX_PAGE_SIZE;
    return visibleTransactions.slice(start, start + TX_PAGE_SIZE);
  }, [visibleTransactions, txPage]);

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
      const sid = ingest.running && ingest.sessionId ? ingest.sessionId : selectedSession;
      if (!project || !sid) {
        setTransactions([]);
        return;
      }
      if (!opts?.silent) setTrafficLoading(true);
      try {
        const { transactions: txs } = await window.atp.getCaptureIndex(project, sid);
        setTransactions(txs);
      } finally {
        if (!opts?.silent) setTrafficLoading(false);
      }
    },
    [project, selectedSession, ingest.running, ingest.sessionId],
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
      const st = await window.atp.getIngestStatus();
      setIngest(st);
      setMitm(await window.atp.mitmStatus());
      setSysProxy(await window.atp.systemProxyStatus());
      if (st.running || selectedSession) await refreshIndex({ silent: true });
    };
    void tick();
    const id = setInterval(() => void tick(), 2000);
    return () => clearInterval(id);
  }, [selectedSession, refreshIndex, ingest.sessionId]);

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

  const onStart = async () => {
    if (!project) return;
    if (!mitmAvail) {
      setMessage("未安装 mitmproxy，请在仓库根目录 pip install -r requirements-capture.txt");
      return;
    }
    setBusy(true);
    setMessage("");
    const res = await window.atp.quickCaptureStart({
      project,
      label,
      hostFilter: "",
      sessionId: undefined,
      setSystemProxy: true,
      proxyMode: "global",
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
      <h2 className="page-head">抓包</h2>

      <section className="card">
        <h3 className="card-title">控制</h3>
        <div className="toolbar">
          <select value={project || ""} disabled={!projects.length} onChange={(e) => onProject(e.target.value)}>
            {!projects.length ? (
              <option value="">暂无项目 — 请先到「项目与用例」新建</option>
            ) : (
              projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </select>
          <input
            className="text-input"
            style={{ flex: 1, maxWidth: 220 }}
            placeholder="备注（可选）"
            value={label}
            disabled={capturing}
            onChange={(e) => setLabel(e.target.value)}
          />
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

        {proxyStale && (
          <p className="hint warn">
            系统代理仍开着但抓包未运行，Chrome 可能无法打开网页（ERR_PROXY_CONNECTION_FAILED）。点「仅恢复上网」后刷新浏览器。
          </p>
        )}

        {message && <p className="hint">{message}</p>}

        {!capturing && (
          <p className="hint">首次：安装证书 → 开始抓包 → Chrome 访问站点。用完点「停止并恢复上网」。</p>
        )}
        {capturing && (
          <p className="hint">
            浏览器：Chrome 访问即可（需先<strong>安装证书</strong>并重开浏览器）。课程/H5 页（如小鹅通）接口常在{" "}
            <code>*.xeknow.com</code> 等<strong>第三方域名</strong>：流量列表可关闭「仅 API」或搜索{" "}
            <code>xeknow</code> / <code>shanxiguandian</code>。南财等桌面终端须完全退出后重启。
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
                  ? `筛选 ${visibleTransactions.length} / 全部 ${transactions.length}`
                  : apiOnlyFilter && apiMatchCount !== transactions.length && !showingAllDespiteApiFilter
                    ? `API ${apiMatchCount} / 全部 ${transactions.length}`
                    : showingAllDespiteApiFilter
                      ? `全部 ${transactions.length} 条（未识别为 API，已全部显示）`
                      : `${transactions.length} 条`}
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
        </div>
        <div className="loading-host capture-traffic-table-host">
          <LoadingOverlay show={trafficLoading} label="加载流量…" />
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>方法</th>
                <th>Path</th>
                <th>URL</th>
              </tr>
            </thead>
            <tbody>
            {pagedTransactions.map((t) => (
              <tr key={t.id} className="clickable" onClick={() => void openTx(t.id)}>
                <td>{t.captured_at}</td>
                <td>{t.method}</td>
                <td>{t.path}</td>
                <td className="url-cell">{t.url}</td>
              </tr>
            ))}
            {!visibleTransactions.length && emptyListState && (
              <tr className="capture-empty-row">
                <td colSpan={4}>
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
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <h3 className="card-title" style={{ margin: 0, flex: 1 }}>
              交易明细
            </h3>
            <button type="button" className="nav-btn" onClick={() => void copyCurl()}>
              复制 cURL
            </button>
            <button type="button" className="nav-btn" onClick={() => downloadCurl()}>
              下载脚本
            </button>
            {onOpenInWorkbench && selectedTx && (
              <button
                type="button"
                className="primary"
                onClick={() => onOpenInWorkbench(captureTxToDraft(selectedTx))}
              >
                在工作台打开
              </button>
            )}
            {selectedTx && (
              <button type="button" className="nav-btn" onClick={() => setSaveCaseOpen(true)}>
                保存为用例
              </button>
            )}
          </div>
          <pre className="curl-block">{draftCurl}</pre>
          <div className="grid-2" style={{ marginTop: 12 }}>
            <pre>{JSON.stringify(selectedTx, null, 2)}</pre>
            <DraftYaml draft={draftYaml} />
          </div>
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
        defaultName={selectedTx ? captureTxToCaseMeta(selectedTx).defaultName : "captured-case"}
        yamlPreview={draftYaml}
        onCancel={() => setSaveCaseOpen(false)}
        onConfirm={({ caseName, addToSuite, suiteName }) => {
          void (async () => {
            if (!project || !draftYaml) return;
            const exists = await window.atp.projectCaseExists(project, caseName);
            setSaveCaseOpen(false);
            if (exists) {
              setPendingCaseOverwrite({ caseName, addToSuite, suiteName, yaml: draftYaml });
              return;
            }
            const res = await window.atp.saveProjectCase(project, caseName, draftYaml, {
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
          if (!pending || !project) return;
          void (async () => {
            const res = await window.atp.saveProjectCase(project, pending.caseName, pending.yaml, {
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
    </>
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