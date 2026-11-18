import { useEffect, useState } from "react";

import type { JtlStreamModeId } from "../../shared/jtlStreamModes";
import JtlStreamModeField from "./JtlStreamModeField";
import {
  applyJtlStreamDefaultToCurrent,
  loadJtlStreamDefaultMode,
  persistJtlStreamDefaultMode,
} from "./jtlStreamModePrefs";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved?: (mode: JtlStreamModeId) => void;
  onToast?: (msg: string) => void;
};

export default function AppPreferencesDialog({ open, onClose, onSaved, onToast }: Props) {
  const [defaultMode, setDefaultMode] = useState<JtlStreamModeId>(() => loadJtlStreamDefaultMode());
  const [applyNow, setApplyNow] = useState(true);

  useEffect(() => {
    if (!open) return;
    setDefaultMode(loadJtlStreamDefaultMode());
    setApplyNow(true);
  }, [open]);

  if (!open) return null;

  const onSave = () => {
    persistJtlStreamDefaultMode(defaultMode);
    if (applyNow) {
      applyJtlStreamDefaultToCurrent();
    }
    onSaved?.(defaultMode);
    onToast?.("偏好已保存");
    onClose();
  };

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card app-preferences-dialog"
        role="dialog"
        aria-labelledby="app-preferences-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h4 id="app-preferences-title" className="modal-title">
          偏好设置
        </h4>
        <p className="hint app-preferences-lede">
          超大 JTL（超过 500MB）在单次加载时会临时使用极速模式预览；可在负载测试页手动切换到深度模式以获取更高精度。
        </p>
        <div className="app-preferences-section">
          <h5 className="sub-title">JTL 流式解析默认模式</h5>
          <JtlStreamModeField value={defaultMode} onChange={setDefaultMode} />
          <label className="app-preferences-check">
            <input type="checkbox" checked={applyNow} onChange={(e) => setApplyNow(e.target.checked)} />
            同时应用到当前负载测试页的「JTL 解析」下拉
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="nav-btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="nav-btn nav-btn--accent" onClick={onSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}