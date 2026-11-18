import { useEffect, useMemo, useState } from "react";

import { formatJsonBody } from "./apiWorkbenchModel";
import JsonResponseView from "./JsonResponseView";
import { parseJsonPreview } from "./parseResponseJson";

type BodyMode = "visual" | "raw";

const PREVIEW_HINT =
  "执行记录仅保存响应体前约 4 KB 预览；可视化基于已解析片段，可能与完整响应略有差异。";

type Props = {
  bodyPreview: string;
};

export default function RunStepResponsePreview({ bodyPreview }: Props) {
  const { value: parsed, partial } = useMemo(() => parseJsonPreview(bodyPreview), [bodyPreview]);
  const looksJson = useMemo(() => {
    const t = bodyPreview.trim();
    return t.startsWith("{") || t.startsWith("[");
  }, [bodyPreview]);
  const [mode, setMode] = useState<BodyMode>(() => (parsed != null ? "visual" : "raw"));

  useEffect(() => {
    setMode(parsed != null ? "visual" : "raw");
  }, [bodyPreview, parsed]);

  const display = useMemo(() => {
    if (parsed != null && partial) {
      try {
        return JSON.stringify(parsed, null, 2);
      } catch {
        return formatJsonBody(bodyPreview);
      }
    }
    return formatJsonBody(bodyPreview);
  }, [bodyPreview, parsed, partial]);

  const truncated = bodyPreview.length >= 4000;
  const showFormatToggle = parsed != null || looksJson;
  const showPreviewInfo = truncated || partial;

  return (
    <div className="run-detail-block run-detail-response-preview">
      <div className="run-detail-response-head">
        <div className="run-detail-response-title-row">
          <h4 className="run-detail-block-title run-detail-response-title">响应预览</h4>
          {showPreviewInfo ? (
            <button
              type="button"
              className="run-detail-preview-info"
              title={PREVIEW_HINT}
              aria-label={PREVIEW_HINT}
            >
              ⓘ
            </button>
          ) : null}
        </div>
        {showFormatToggle ? (
          <div className="run-detail-segmented" role="tablist" aria-label="响应体格式">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "visual"}
              className={`run-detail-segmented-btn${mode === "visual" ? " run-detail-segmented-btn--active" : ""}`}
              disabled={parsed == null}
              title={parsed == null ? "无法解析为 JSON，仅可查看原文" : undefined}
              onClick={() => setMode("visual")}
            >
              可视化
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "raw"}
              className={`run-detail-segmented-btn${mode === "raw" ? " run-detail-segmented-btn--active" : ""}`}
              onClick={() => setMode("raw")}
            >
              JSON
            </button>
          </div>
        ) : null}
      </div>
      {partial && mode === "visual" ? <p className="run-detail-preview-banner">{PREVIEW_HINT}</p> : null}
      {parsed != null && mode === "visual" ? (
        <JsonResponseView data={parsed} className="run-detail-response-visual" enableRowSelection={false} />
      ) : (
        <pre className="run-detail-body-preview">{display}</pre>
      )}
    </div>
  );
}