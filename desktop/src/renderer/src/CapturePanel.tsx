import { useCallback, useEffect, useMemo, useState } from "react";

import ConfirmDialog from "./ConfirmDialog";
import { transactionToCurl } from "./captureCurl";
import { filterTransactions } from "./captureFilters";

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
};

export default function CapturePanel({ projects, project, onProject }: Props) {
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
  const [mitm, setMitm] = useState<Awaited<ReturnType<typeof window.atp.mitmStatus>>>({ running: false });
  const [mitmAvail, setMitmAvail] = useState(false);
  const [apiOnlyFilter] = useState(true);
  const [txPage, setTxPage] = useState(1);
  const [sysProxy, setSysProxy] = useState<{ enabled: boolean; server: string; autoConfigUrl?: string }>({
    enabled: false,
    server: "",
  });
  const capturing = ingest.running || mitm.running;

  const visibleTransactions = useMemo(
    () => filterTransactions(transactions, apiOnlyFilter),
    [transactions, apiOnlyFilter],
  );

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

  const activeSessionId =
    ingest.running && ingest.sessionId ? ingest.sessionId : selectedSession;

  useEffect(() => {
    setTxPage(1);
  }, [activeSessionId, apiOnlyFilter]);

  useEffect(() => {
    if (txPage > txPageCount) setTxPage(txPageCount);
  }, [txPage, txPageCount]);

  const refreshIndex = useCallback(async () => {
    const sid = ingest.running && ingest.sessionId ? ingest.sessionId : selectedSession;
    if (!project || !sid) {
      setTransactions([]);
      return;
    }
    const { transactions: txs } = await window.atp.getCaptureIndex(project, sid);
    setTransactions(txs);
  }, [project, selectedSession, ingest.running, ingest.sessionId]);

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
      if (st.running || selectedSession) await refreshIndex();
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
    const tx = await window.atp.getCaptureTransaction(project, sid, txId);
    setSelectedTx(tx);
    setDraftYaml(tx ? transactionToCaseDraft(tx) : "");
    setDraftCurl(tx ? transactionToCurl(tx) : "");
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

  const runDeleteSession = async () => {
    const sid = activeSessionId;
    if (!project || !sid) return;
    setBusy(true);
    const res = await window.atp.deleteCaptureSession(project, sid);
    setBusy(false);
    if (!res.ok) {
      showDetailToast(res.error ?? "删除失败");
      return;
    }
    setSelectedTx(null);
    setDraftYaml("");
    setDraftCurl("");
    setSelectedSession("");
    showDetailToast("已删除会话");
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

  const onDeleteSession = () => {
    if (!project || !activeSessionId) return;
    setPendingConfirm({
      title: "删除会话",
      message: "将删除整个抓包会话目录，不可恢复。若正在抓包，请先停止。",
      confirmLabel: "删除",
      danger: true,
      run: () => void runDeleteSession(),
    });
  };

  return (
    <>
      <h2 className="page-head">抓包</h2>

      <section className="card">
        <h3 className="card-title">控制</h3>
        <div className="toolbar">
          <select value={project} onChange={(e) => onProject(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
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
            浏览器：Chrome 访问即可。南财等<strong>桌面终端</strong>：开始抓包后需
            <strong>完全退出并重启终端</strong>（已同步 WinHTTP+系统代理）。HTTPS 必须先装证书；若仍无流量，终端可能不走代理或证书锁定。
          </p>
        )}
      </section>

      <section className="card traffic-anchor">
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <h3 className="card-title" style={{ margin: 0, flex: 1 }}>
            流量列表
            {activeSessionId && (
              <span className="hint" style={{ fontWeight: 400, marginLeft: 8 }}>
                {apiOnlyFilter && transactions.length !== visibleTransactions.length
                  ? `API ${visibleTransactions.length} / 全部 ${transactions.length}`
                  : `${transactions.length} 条`}
              </span>
            )}
          </h3>
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
            disabled={busy || !activeSessionId || capturing}
            title="删除整个会话目录"
            onClick={() => void onDeleteSession()}
          >
            删除会话
          </button>
        </div>
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
            {!visibleTransactions.length && (
              <tr>
                <td colSpan={4} className="muted-cell">
                  {transactions.length && apiOnlyFilter
                    ? "当前无 API 记录（已自动隐藏图片）；请在抓包过程中访问业务接口"
                    : "暂无记录；开始抓包后用 Chrome 访问站点"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
        <section className="card">
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
    </>
  );
}

function DraftYaml({ draft }: { draft: string }) {
  return (
    <div>
      <h4 className="sub-title">用例草案（YAML）</h4>
      <pre>{draft}</pre>
      <p className="hint">复制到 projects/…/cases/ 后按需改断言与变量。</p>
    </div>
  );
}

function transactionToCaseDraft(tx: unknown): string {
  const t = tx as {
    request?: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown };
  };
  const method = t.request?.method ?? "GET";
  const url = t.request?.url ?? "";
  const lines = [
    "name: captured-case",
    "description: 由抓包生成，请检查变量与断言",
    "request:",
    `  method: ${method}`,
    `  url: "${url.replace(/"/g, '\\"')}"`,
  ];
  if (t.request?.headers && Object.keys(t.request.headers).length) {
    lines.push("  headers:");
    for (const [k, v] of Object.entries(t.request.headers)) {
      lines.push(`    ${k}: "${String(v).replace(/"/g, '\\"')}"`);
    }
  }
  if (t.request?.body !== undefined) {
    lines.push(`  body: ${JSON.stringify(t.request.body)}`);
  }
  lines.push("assertions:", "  - type: status", "    equals: 200");
  return lines.join("\n");
}