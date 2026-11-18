import { useEffect, useMemo, useState } from "react";

import LoadingOverlay from "./LoadingOverlay";
import { emptyRow } from "./apiWorkbenchModel";
import type { KeyValueRow } from "../../shared/apiWorkbenchTypes";
import { templateVarNamesInDraft } from "../../shared/vars";

type Props = {
  open: boolean;
  project: string;
  envName: string;
  variableNames: string[];
  onCancel: () => void;
  onSaved: () => void;
};

export default function EnvVariablesDialog({
  open,
  project,
  envName,
  variableNames,
  onCancel,
  onSaved,
}: Props) {
  const [rows, setRows] = useState<KeyValueRow[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const wantedKeys = useMemo(() => [...new Set(variableNames)], [variableNames]);

  useEffect(() => {
    if (!open || !project) return;
    void (async () => {
      setLoading(true);
      try {
        const vars = await window.atp.getProjectVariables(project, envName);
        const list: KeyValueRow[] = wantedKeys.map((key) => ({
          key,
          value: vars[key] ?? "",
          enabled: true,
        }));
        setRows(list.length ? list : [emptyRow()]);
        setError("");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, project, envName, wantedKeys]);

  const onSave = async () => {
    if (!project) return;
    const variables: Record<string, string> = {};
    for (const row of rows) {
      if (!row.key.trim()) continue;
      variables[row.key.trim()] = row.value;
    }
    setSaving(true);
    const res = await window.atp.saveProjectEnvLocal(project, envName, variables);
    setSaving(false);
    if (!res.ok) {
      setError("保存失败");
      return;
    }
    onSaved();
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal-card modal-card--wide"
        role="dialog"
        aria-labelledby="env-vars-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h4 id="env-vars-title" className="modal-title">
          环境变量 · {envName}
        </h4>
        <p className="modal-message" style={{ marginBottom: 12 }}>
          保存至 <code>environments/{envName}.local.yaml</code>（不提交 Git，本项目所有用例与工作台 Send 共用）。填写后点「保存并应用」，无需在用例 YAML 里再写 token/secret。
        </p>
        <div className="workbench-kv loading-host" style={{ maxHeight: 280, minHeight: 120 }}>
          <LoadingOverlay show={loading} label="加载变量…" />
          <table>
            <thead>
              <tr>
                <th>变量</th>
                <th>值</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td>
                    <input
                      className="text-input workbench-kv-input"
                      value={row.key}
                      onChange={(e) =>
                        setRows((list) =>
                          list.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="text-input workbench-kv-input"
                      type={row.key === "token" ? "password" : "text"}
                      value={row.value}
                      placeholder={row.key === "token" ? "JWT" : row.key === "base_url" ? "https://api.example.com" : ""}
                      onChange={(e) =>
                        setRows((list) =>
                          list.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)),
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="nav-btn workbench-add-row"
            onClick={() => setRows((r) => [...r, emptyRow()])}
          >
            + 添加行
          </button>
        </div>
        {error && <p className="hint warn">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="nav-btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary" disabled={saving} onClick={() => void onSave()}>
            {saving ? "保存中…" : "保存并应用"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function collectTemplateVarNames(draft: {
  url: string;
  query: { value: string }[];
  headers: { value: string }[];
  body: string;
}): string[] {
  return templateVarNamesInDraft(draft);
}