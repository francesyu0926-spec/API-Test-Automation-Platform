import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  copyFrom?: string;
  suggestedBaseUrl?: string;
  onCancel: () => void;
  onCreate: (opts: { envName: string; copyFrom?: string; baseUrl?: string }) => void;
};

export default function CreateEnvDialog({ open, copyFrom, suggestedBaseUrl, onCancel, onCreate }: Props) {
  const [envName, setEnvName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [copyVars, setCopyVars] = useState(true);

  useEffect(() => {
    if (!open) return;
    setEnvName("");
    setBaseUrl(suggestedBaseUrl?.trim() || "");
    setCopyVars(Boolean(copyFrom));
  }, [open, suggestedBaseUrl, copyFrom]);

  if (!open) return null;

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-card" role="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h4 className="modal-title">新建环境</h4>
        <p className="modal-message" style={{ marginBottom: 12 }}>
          将在项目中创建 <code>environments/&lt;名称&gt;.yaml</code>（可提交 Git）。敏感值请用「变量」保存到{" "}
          <code>*.local.yaml</code>。
        </p>
        <label className="perf-field" style={{ width: "100%", marginBottom: 10 }}>
          <span>环境名（如 staging、prod）</span>
          <input
            className="text-input"
            style={{ width: "100%" }}
            value={envName}
            placeholder="staging"
            onChange={(e) => setEnvName(e.target.value)}
          />
        </label>
        <label className="perf-field" style={{ width: "100%", marginBottom: 10 }}>
          <span>base_url（可选）</span>
          <input
            className="text-input"
            style={{ width: "100%" }}
            value={baseUrl}
            placeholder="https://api.example.com"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        {copyFrom ? (
          <label className="perf-field" style={{ width: "100%", marginBottom: 16, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={copyVars} onChange={(e) => setCopyVars(e.target.checked)} />
            <span>从当前环境「{copyFrom}」复制变量</span>
          </label>
        ) : (
          <div style={{ marginBottom: 16 }} />
        )}
        <div className="modal-actions">
          <button type="button" className="nav-btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            onClick={() =>
              onCreate({
                envName,
                copyFrom: copyFrom && copyVars ? copyFrom : undefined,
                baseUrl: baseUrl.trim() || undefined,
              })
            }
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}