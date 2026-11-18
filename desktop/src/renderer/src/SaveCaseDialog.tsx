import { useEffect, useState } from "react";

import ProjectTargetField from "./ProjectTargetField";

type Props = {
  open: boolean;
  defaultProjectId?: string;
  suggestedBaseUrl?: string;
  defaultName: string;
  yamlPreview: string;
  onCancel: () => void;
  onConfirm: (opts: {
    projectId: string;
    caseName: string;
    addToSuite: boolean;
    suiteName: string;
  }) => void;
};

export default function SaveCaseDialog({
  open,
  defaultProjectId,
  suggestedBaseUrl,
  defaultName,
  yamlPreview,
  onCancel,
  onConfirm,
}: Props) {
  const [caseName, setCaseName] = useState(defaultName);
  const [addToSuite, setAddToSuite] = useState(true);
  const [suiteName, setSuiteName] = useState("smoke");
  const [projectId, setProjectId] = useState("");

  useEffect(() => {
    if (!open) return;
    setCaseName(defaultName);
  }, [open, defaultName]);

  if (!open) return null;

  const canSave = Boolean(projectId.trim() && caseName.trim());

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal-card modal-card--wide"
        role="dialog"
        aria-labelledby="save-case-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h4 id="save-case-title" className="modal-title">
          保存为自动化用例
        </h4>
        <ProjectTargetField
          active={open}
          value={projectId}
          onChange={setProjectId}
          defaultProjectId={defaultProjectId}
          suggestedBaseUrl={suggestedBaseUrl}
        />
        <label className="perf-field" style={{ marginBottom: 12, width: "100%" }}>
          <span>用例文件名（cases/*.yaml）</span>
          <input
            className="text-input"
            style={{ width: "100%" }}
            value={caseName}
            onChange={(e) => setCaseName(e.target.value)}
          />
        </label>
        <label className="check-label" style={{ marginBottom: 8 }}>
          <input type="checkbox" checked={addToSuite} onChange={(e) => setAddToSuite(e.target.checked)} />
          加入套件
        </label>
        {addToSuite && (
          <input
            className="text-input"
            style={{ width: "100%", marginBottom: 12 }}
            value={suiteName}
            onChange={(e) => setSuiteName(e.target.value)}
            placeholder="smoke"
          />
        )}
        <pre className="code-block save-case-preview">{yamlPreview}</pre>
        <div className="modal-actions">
          <button type="button" className="nav-btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canSave}
            onClick={() =>
              onConfirm({
                projectId: projectId.trim(),
                caseName: caseName.trim(),
                addToSuite,
                suiteName,
              })
            }
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}