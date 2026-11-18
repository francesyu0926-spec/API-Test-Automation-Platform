import { useEffect, useMemo, useState } from "react";

import { previewProjectId } from "./projectIdPreview";

const DEFAULT_BASE_URL = "https://api.example.com";

type Props = {
  open: boolean;
  nested?: boolean;
  suggestedBaseUrl?: string;
  onCancel: () => void;
  onCreate: (opts: { id: string; name: string; baseUrl: string }) => void;
};

export default function CreateProjectDialog({
  open,
  nested,
  suggestedBaseUrl,
  onCancel,
  onCreate,
}: Props) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);

  useEffect(() => {
    if (!open) return;
    const hinted = suggestedBaseUrl?.trim();
    setBaseUrl(hinted || DEFAULT_BASE_URL);
  }, [open, suggestedBaseUrl]);

  const idPreview = useMemo(() => previewProjectId(id), [id]);

  if (!open) return null;

  return (
    <div className={`modal-overlay${nested ? " modal-overlay--nested" : ""}`} role="presentation">
      <div className="modal-card" role="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h4 className="modal-title">新建项目</h4>
        <label className="perf-field" style={{ width: "100%", marginBottom: 10 }}>
          <span>项目 ID（目录名）</span>
          <input
            className="text-input"
            style={{ width: "100%" }}
            value={id}
            placeholder="my-service"
            onChange={(e) => setId(e.target.value)}
          />
          <span className="hint" style={{ marginTop: 6 }}>
            {idPreview
              ? idPreview !== id.trim().toLowerCase()
                ? `实际目录 ID：${idPreview}（中文等字符会转为英文目录名，与「显示名称」无关）`
                : `目录 ID：${idPreview}`
              : "请填写英文、数字或连字符组成的 ID"}
          </span>
        </label>
        <label className="perf-field" style={{ width: "100%", marginBottom: 10 }}>
          <span>显示名称</span>
          <input
            className="text-input"
            style={{ width: "100%" }}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="perf-field" style={{ width: "100%", marginBottom: 16 }}>
          <span>dev 环境 base_url</span>
          <input
            className="text-input"
            style={{ width: "100%" }}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="nav-btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => onCreate({ id, name: name || id, baseUrl })}
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}