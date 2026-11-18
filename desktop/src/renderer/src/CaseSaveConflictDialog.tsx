import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  caseName: string;
  renameDefault: string;
  onCancel: () => void;
  onOverwrite: () => void;
  onSaveAs: (newCaseName: string) => void;
};

export default function CaseSaveConflictDialog({
  open,
  caseName,
  renameDefault,
  onCancel,
  onOverwrite,
  onSaveAs,
}: Props) {
  const [rename, setRename] = useState(renameDefault);

  useEffect(() => {
    if (open) setRename(renameDefault);
  }, [open, renameDefault]);

  if (!open) return null;

  const canSaveAs = Boolean(rename.trim());

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onCancel}>
      <div
        className="modal-card"
        role="alertdialog"
        aria-labelledby="case-conflict-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h4 id="case-conflict-title" className="modal-title">
          用例已存在
        </h4>
        <p className="modal-message">
          集合已保存。<code>cases/{caseName}.yaml</code> 已存在，是否覆盖？也可另存为新文件名。
        </p>
        <label className="perf-field case-conflict-rename" style={{ marginBottom: 12, width: "100%" }}>
          <span>另存为用例名</span>
          <input
            className="text-input"
            style={{ width: "100%" }}
            value={rename}
            onChange={(e) => setRename(e.target.value)}
            placeholder="新用例文件名"
          />
        </label>
        <div className="modal-actions case-conflict-actions">
          <button type="button" className="nav-btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="nav-btn" disabled={!canSaveAs} onClick={() => onSaveAs(rename.trim())}>
            另存为
          </button>
          <button type="button" className="primary danger" onClick={onOverwrite}>
            覆盖
          </button>
        </div>
      </div>
    </div>
  );
}