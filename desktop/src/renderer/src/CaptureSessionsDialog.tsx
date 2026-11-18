import { useEffect, useRef, useState } from "react";

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

  /** 仅在弹窗打开时初始化勾选，避免父组件重渲染把全选状态冲掉 */
  useEffect(() => {
    if (open) setPicked(new Set(initialSelectedRef.current));
  }, [open]);

  if (!open) return null;

  const selectable = sessions.filter((s) => s.id !== lockedSessionId);
  const allSelectableChecked =
    selectable.length > 0 && selectable.every((s) => picked.has(s.id));

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
        className="modal-card modal-card--wide"
        role="dialog"
        aria-labelledby="capture-sessions-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h4 id="capture-sessions-title" className="modal-title">
          删除抓包会话
        </h4>
        <p className="modal-message" style={{ marginBottom: 12 }}>
          勾选要删除的历史会话（不可恢复）。正在抓包的当前会话无法删除。
        </p>
        <div className="capture-session-pick">
          <label className="check-label capture-session-pick-all">
            <input
              type="checkbox"
              checked={allSelectableChecked}
              onChange={toggleAll}
              onClick={(e) => e.stopPropagation()}
            />
            全选可删项 ({selectable.length})
          </label>
          <ul className="capture-session-pick-list">
            {sessions.map((s) => {
              const locked = s.id === lockedSessionId;
              return (
                <li key={s.id}>
                  <label className={`capture-session-pick-row${locked ? " locked" : ""}`}>
                    <input
                      type="checkbox"
                      checked={picked.has(s.id)}
                      disabled={locked}
                      onChange={() => toggle(s.id)}
                    />
                    <span className="capture-session-pick-meta">
                      <strong>{s.transactionCount} 条</strong>
                      {s.label ? ` · ${s.label}` : null}
                      <span className="hint"> · {s.id}</span>
                    </span>
                    {locked ? <span className="hint warn">抓包中</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="modal-actions">
          <button type="button" className="nav-btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="primary danger"
            disabled={busy || picked.size === 0}
            onClick={() => onConfirm([...picked])}
          >
            {busy ? "删除中…" : `删除所选 (${picked.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}