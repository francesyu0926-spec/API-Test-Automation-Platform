import { useEffect, useMemo, useRef, useState } from "react";

type SessionRow = {
  id: string;
  label?: string;
  started_at: string;
  transactionCount: number;
};

type Props = {
  open: boolean;
  sessions: SessionRow[];
  lockedSessionId: string | null;
  initialSelected: string[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (sessionIds: string[]) => void;
};

function formatSessionIdHeadline(sessionId: string): string {
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

function formatSessionListTime(s: SessionRow): string {
  if (s.started_at) {
    const d = new Date(s.started_at);
    if (!Number.isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  }
  return formatSessionIdHeadline(s.id);
}

function sessionIdShortHash(sessionId: string): string {
  const dash = sessionId.indexOf("-");
  if (dash < 0) return sessionId.slice(0, 8);
  return sessionId.slice(dash + 1, dash + 9);
}

function CaptureTrashIcon() {
  return (
    <svg className="capture-session-btn-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M5.5 1.75a.75.75 0 0 1 .75-.75H9.75a.75.75 0 0 1 .75.75V3h3.25a.75.75 0 0 1 0 1.5h-.38l-.83 9.2A1.5 1.5 0 0 1 11.08 15H4.92a1.5 1.5 0 0 1-1.49-1.3l-.83-9.2H2.5a.75.75 0 0 1 0-1.5H5.5V1.75Zm2 .75v.5h1.5V2.5H7.5ZM4.5 4.5l.78 8.6a.25.25 0 0 0 .24.22h5.16a.25.25 0 0 0 .24-.22l.78-8.6H4.5Z"
      />
    </svg>
  );
}

function CaptureSessionLockIcon() {
  return (
    <svg className="capture-session-lock-icon" viewBox="0 0 16 16" aria-hidden>
      <path
        fill="currentColor"
        d="M4.5 7V5.5a3.5 3.5 0 1 1 7 0V7h.5A1.5 1.5 0 0 1 13.5 8.5v5A1.5 1.5 0 0 1 12 15H4a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 4 7h.5Zm1.5 0h4V5.5a2 2 0 1 0-4 0V7Z"
      />
    </svg>
  );
}

export default function CaptureSessionsDialog({
  open,
  sessions,
  lockedSessionId,
  initialSelected,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const initialSelectedRef = useRef(initialSelected);
  initialSelectedRef.current = initialSelected;

  useEffect(() => {
    if (open) setPicked(new Set(initialSelectedRef.current));
  }, [open]);

  const orderedSessions = useMemo(() => {
    const copy = [...sessions];
    copy.sort((a, b) => {
      const ta = a.started_at || a.id;
      const tb = b.started_at || b.id;
      return ta < tb ? 1 : ta > tb ? -1 : 0;
    });
    return copy;
  }, [sessions]);

  if (!open) return null;

  const selectable = sessions.filter((s) => s.id !== lockedSessionId);
  const allSelectableChecked =
    selectable.length > 0 && selectable.every((s) => picked.has(s.id));

  const pickedRows = sessions.filter((s) => picked.has(s.id));
  const allPickedEmpty =
    pickedRows.length > 0 && pickedRows.every((s) => s.transactionCount === 0);
  const deleteBtnLabel = busy
    ? "删除中…"
    : allPickedEmpty && picked.size === 1
      ? "删除 1 个空会话"
      : allPickedEmpty && picked.size > 1
        ? `删除 ${picked.size} 个空会话`
        : `删除所选 (${picked.size})`;

  const toggle = (id: string) => {
    if (id === lockedSessionId) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelectableChecked) {
      setPicked(new Set());
      return;
    }
    setPicked(new Set(selectable.map((s) => s.id)));
  };

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal-card modal-card--wide capture-sessions-dialog"
        role="dialog"
        aria-labelledby="capture-sessions-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h4 id="capture-sessions-title" className="modal-title">
          删除抓包会话
        </h4>
        <p className="modal-message" style={{ marginBottom: 12 }}>
          勾选要删除的历史会话（<span className="capture-session-irreversible">不可恢复</span>
          ）。正在抓包的当前会话无法删除。
        </p>
        <div className="capture-session-pick">
          <div className="capture-session-pick-toolbar">
            <label className="check-label capture-session-pick-all">
              <input
                type="checkbox"
                className="capture-session-checkbox"
                checked={allSelectableChecked}
                disabled={!selectable.length}
                onChange={toggleAll}
                onClick={(e) => e.stopPropagation()}
              />
              全选可删项 ({selectable.length})
            </label>
          </div>
          <ul className="capture-session-pick-list">
            {orderedSessions.map((s) => {
              const locked = s.id === lockedSessionId;
              return (
                <li key={s.id}>
                  <label
                    className={`capture-session-pick-row${locked ? " capture-session-pick-row--locked" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="capture-session-checkbox"
                      checked={picked.has(s.id)}
                      disabled={locked}
                      onChange={() => toggle(s.id)}
                    />
                    <span className="capture-session-pick-main">
                      <span
                        className={`capture-session-count-badge${s.transactionCount === 0 ? " is-empty" : ""}`}
                      >
                        {s.transactionCount} 条
                      </span>
                      <span className="capture-session-pick-time">{formatSessionListTime(s)}</span>
                      {s.label ? <span className="capture-session-pick-label">{s.label}</span> : null}
                      <span className="capture-session-pick-id" title={s.id}>
                        {sessionIdShortHash(s.id)}
                      </span>
                    </span>
                    {locked ? (
                      <span className="capture-session-locked-tag">
                        <CaptureSessionLockIcon />
                        进行中，不可删除
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="modal-actions capture-sessions-dialog-actions">
          <button
            type="button"
            className="modal-btn-cancel capture-sessions-dialog-cancel"
            onClick={onCancel}
          >
            <span className="capture-sessions-dialog-cancel-icon" aria-hidden>
              ×
            </span>
            取消
          </button>
          <button
            type="button"
            className="primary danger capture-session-delete-btn"
            disabled={busy || picked.size === 0}
            onClick={() => onConfirm([...picked])}
          >
            <CaptureTrashIcon />
            {deleteBtnLabel}
          </button>
        </div>
      </div>
    </div>
  );
}