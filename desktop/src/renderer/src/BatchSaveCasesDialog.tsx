import { Fragment, useEffect, useMemo, useState } from "react";

import type { BatchCaseRow } from "./captureBatchCases";
import ProjectTargetField, { suggestBaseUrlFromUrls } from "./ProjectTargetField";
import YamlHighlightEditor from "./YamlHighlightEditor";

type Props = {
  open: boolean;
  rows: BatchCaseRow[];
  saving: boolean;
  defaultProjectId?: string;
  onCancel: () => void;
  onConfirm: (opts: {
    projectId: string;
    items: BatchCaseRow[];
    addToSuite: boolean;
    suiteName: string;
    overwriteExisting: boolean;
    openProjects: boolean;
  }) => void;
  onCopied?: (message: string) => void;
};

export default function BatchSaveCasesDialog({
  open,
  rows,
  saving,
  defaultProjectId,
  onCancel,
  onConfirm,
  onCopied,
}: Props) {
  const [items, setItems] = useState<BatchCaseRow[]>([]);
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [addToSuite, setAddToSuite] = useState(true);
  const [suiteName, setSuiteName] = useState("smoke");
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [openProjects, setOpenProjects] = useState(true);
  const [projectId, setProjectId] = useState("");

  const suggestedBaseUrl = useMemo(
    () => suggestBaseUrlFromUrls(rows.map((r) => r.url)),
    [rows],
  );

  useEffect(() => {
    if (!open) return;
    setItems(rows.map((r) => ({ ...r })));
    setExpandedTxId(rows[0]?.txId ?? null);
  }, [open, rows]);

  if (!open) return null;

  const patchName = (txId: string, caseName: string) => {
    setItems((prev) => prev.map((r) => (r.txId === txId ? { ...r, caseName } : r)));
  };

  const removeItem = (txId: string) => {
    if (saving) return;
    setItems((prev) => prev.filter((r) => r.txId !== txId));
    setExpandedTxId((cur) => (cur === txId ? null : cur));
  };

  const patchYaml = (txId: string, yaml: string) => {
    setItems((prev) => prev.map((r) => (r.txId === txId ? { ...r, yaml } : r)));
  };

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal-card modal-card--wide"
        role="dialog"
        aria-labelledby="batch-save-cases-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h4 id="batch-save-cases-title" className="modal-title">
          保存到项目用例（{items.length} 条）
        </h4>
        <ProjectTargetField
          active={open}
          value={projectId}
          onChange={setProjectId}
          defaultProjectId={defaultProjectId}
          suggestedBaseUrl={suggestedBaseUrl}
          disabled={saving}
        />
        <div className="batch-save-cases-list">
          <table>
            <thead>
              <tr>
                <th>方法</th>
                <th>Path</th>
                <th>用例文件名</th>
                <th className="batch-save-col-action" aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="batch-save-empty">
                    已从列表移除全部条目，请取消或关闭后重新勾选流量。
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <Fragment key={r.txId}>
                    <tr>
                      <td>{r.method}</td>
                      <td className="url-cell" title={r.url}>
                        {r.path}
                      </td>
                      <td>
                        <input
                          className="text-input batch-save-case-name"
                          value={r.caseName}
                          disabled={saving}
                          onChange={(e) => patchName(r.txId, e.target.value)}
                        />
                      </td>
                      <td className="batch-save-col-action">
                        <button
                          type="button"
                          className={`nav-btn nav-btn--compact nav-btn--ghost batch-save-yaml-toggle${expandedTxId === r.txId ? " batch-save-yaml-toggle--open" : ""}`}
                          disabled={saving}
                          title="展开或收起 YAML 编辑"
                          onClick={() => setExpandedTxId((cur) => (cur === r.txId ? null : r.txId))}
                        >
                          {expandedTxId === r.txId ? "收起 YAML" : "编辑 YAML"}
                        </button>
                        <button
                          type="button"
                          className="nav-btn batch-save-remove"
                          disabled={saving}
                          title="从本次保存列表移除"
                          onClick={() => removeItem(r.txId)}
                        >
                          移除
                        </button>
                      </td>
                    </tr>
                    {expandedTxId === r.txId ? (
                      <tr key={`${r.txId}-yaml`} className="batch-save-yaml-row">
                        <td colSpan={4}>
                          <YamlHighlightEditor
                            value={r.yaml}
                            onChange={(yaml) => patchYaml(r.txId, yaml)}
                            onCopied={onCopied}
                            ariaLabel={`${r.caseName} YAML`}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
        <label className="check-label" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={addToSuite} onChange={(e) => setAddToSuite(e.target.checked)} />
          加入套件
        </label>
        {addToSuite ? (
          <input
            className="text-input"
            style={{ width: "100%", marginBottom: 8 }}
            value={suiteName}
            disabled={saving}
            onChange={(e) => setSuiteName(e.target.value)}
            placeholder="smoke"
          />
        ) : null}
        <label className="check-label">
          <input
            type="checkbox"
            checked={overwriteExisting}
            onChange={(e) => setOverwriteExisting(e.target.checked)}
          />
          覆盖同名用例（不勾选则跳过已存在文件）
        </label>
        <label className="check-label" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={openProjects} onChange={(e) => setOpenProjects(e.target.checked)} />
          保存后打开「项目与用例」
        </label>
        <div className="modal-actions">
          <button type="button" className="nav-btn" disabled={saving} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={saving || !items.length || !projectId.trim()}
            onClick={() =>
              onConfirm({
                projectId: projectId.trim(),
                items,
                addToSuite,
                suiteName,
                overwriteExisting,
                openProjects,
              })
            }
          >
            {saving ? "保存中…" : `保存 ${items.length} 个用例`}
          </button>
        </div>
      </div>
    </div>
  );
}