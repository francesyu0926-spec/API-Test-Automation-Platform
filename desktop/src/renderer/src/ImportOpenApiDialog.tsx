import { useEffect, useMemo, useState } from "react";

import type { ParsedOpenApi } from "./openapiImport";
import { previewProjectId } from "./projectIdPreview";

type Props = {
  open: boolean;
  busy?: boolean;
  sourceFile?: string;
  parsed: ParsedOpenApi | null;
  onCancel: () => void;
  onImport: (opts: {
    projectId: string;
    projectName: string;
    baseUrl: string;
    collectionId: string;
    collectionName: string;
  }) => void;
};

export default function ImportOpenApiDialog({
  open,
  busy,
  sourceFile,
  parsed,
  onCancel,
  onImport,
}: Props) {
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.example.com");
  const [collectionId, setCollectionId] = useState("openapi");

  useEffect(() => {
    if (!open || !parsed) return;
    setProjectId(parsed.suggestedProjectId);
    setProjectName(parsed.info.title);
    setBaseUrl(parsed.baseUrl);
    setCollectionId("openapi");
  }, [open, parsed]);

  const idPreview = useMemo(() => previewProjectId(projectId), [projectId]);
  const requestCount = parsed?.requests.length ?? 0;

  if (!open || !parsed) return null;

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-card modal-card--wide" role="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h4 className="modal-title">从 OpenAPI 导入项目</h4>
        {sourceFile ? (
          <p className="hint" style={{ marginBottom: 12 }}>
            来源：{sourceFile}
          </p>
        ) : null}
        <p className="hint" style={{ marginBottom: 16 }}>
          将导入 <strong>{requestCount}</strong> 条请求：写入 API 集合（OpenAPI 文件夹），并同步生成{" "}
          <code>cases/*.yaml</code> 用例（加入 smoke 套件），可在「项目与用例」中查看与执行。
        </p>
        {parsed.warnings.map((w) => (
          <p key={w} className="hint" style={{ marginBottom: 8, color: "var(--warn-fg, #c9a227)" }}>
            {w}
          </p>
        ))}
        <label className="perf-field" style={{ width: "100%", marginBottom: 10 }}>
          <span>项目 ID（目录名）</span>
          <input
            className="text-input"
            style={{ width: "100%" }}
            value={projectId}
            disabled={busy}
            onChange={(e) => setProjectId(e.target.value)}
          />
          <span className="hint" style={{ marginTop: 6 }}>
            {idPreview ? `实际目录：${idPreview}` : "请填写项目 ID"}
          </span>
        </label>
        <label className="perf-field" style={{ width: "100%", marginBottom: 10 }}>
          <span>显示名称</span>
          <input
            className="text-input"
            style={{ width: "100%" }}
            value={projectName}
            disabled={busy}
            onChange={(e) => setProjectName(e.target.value)}
          />
        </label>
        <label className="perf-field" style={{ width: "100%", marginBottom: 10 }}>
          <span>dev 环境 base_url</span>
          <input
            className="text-input"
            style={{ width: "100%" }}
            value={baseUrl}
            disabled={busy}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        <label className="perf-field" style={{ width: "100%", marginBottom: 16 }}>
          <span>集合 ID（文件）</span>
          <input
            className="text-input"
            style={{ width: "100%" }}
            value={collectionId}
            disabled={busy}
            onChange={(e) => setCollectionId(e.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="nav-btn" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !idPreview}
            onClick={() =>
              onImport({
                projectId,
                projectName: projectName || projectId,
                baseUrl,
                collectionId: collectionId || "openapi",
                collectionName: parsed.collectionName,
              })
            }
          >
            {busy ? "导入中…" : "创建并导入"}
          </button>
        </div>
      </div>
    </div>
  );
}