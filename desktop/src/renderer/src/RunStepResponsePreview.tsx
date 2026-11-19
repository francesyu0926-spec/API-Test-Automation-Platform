import { useCallback, useEffect, useMemo, useState } from "react";

import { formatJsonBody } from "./apiWorkbenchModel";
import CaptureCodeBlock from "./CaptureCodeBlock";
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
  const [jsonPretty, setJsonPretty] = useState(true);

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

  const copyPayload = useMemo(() => {
    if (mode === "raw" && looksJson && jsonPretty) {
      try {
        return JSON.stringify(JSON.parse(display), null, 2);
      } catch {
        return display;
      }
    }
    if (mode === "raw" && looksJson && !jsonPretty) {
      try {
        return JSON.stringify(JSON.parse(display));
      } catch {
        return display;
      }
    }
    return display;
  }, [display, jsonPretty, looksJson, mode]);

  const onCopy = useCallback(async () => {
    try {
      await window.atp.copyText(copyPayload);
    } catch {
      try {
        await navigator.clipboard.writeText(copyPayload);
      } catch {
        /* ignore */
      }
    }
  }, [copyPayload]);

  const truncated = bodyPreview.length >= 4000;
  const showFormatToggle = parsed != null || looksJson;
  const showPreviewInfo = truncated || partial;

  return (
    <div className="run-detail-block run-detail-response-preview">
      <header className="run-detail-response-head run-detail-response-head--unified">
        <div className="run-detail-response-head-start">
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
          <div className="run-detail-segmented run-detail-response-head-segmented" role="tablist" aria-label="响应体格式">
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
        ) : (
          <span className="run-detail-response-head-spacer" aria-hidden />
        )}
        <div className="run-detail-response-head-actions">
          {mode === "raw" && showFormatToggle ? (
            <>
              <button
                type="button"
                className="run-detail-response-icon-btn"
                title="复制 JSON"
                aria-label="复制"
                onClick={() => void onCopy()}
              >
                <span aria-hidden>📋</span>
                <span>复制</span>
              </button>
              <button
                type="button"
                className="run-detail-response-icon-btn"
                title={jsonPretty ? "压缩为一行" : "格式化缩进"}
                aria-label={jsonPretty ? "压缩" : "格式化"}
                onClick={() => setJsonPretty((v) => !v)}
              >
                <span className="run-detail-response-format-icon" aria-hidden>
                  {"{}"}
                </span>
                <span>{jsonPretty ? "压缩" : "格式化"}</span>
              </button>
            </>
          ) : null}
        </div>
      </header>
      {partial && mode === "visual" ? <p className="run-detail-preview-banner">{PREVIEW_HINT}</p> : null}
      {parsed != null && mode === "visual" ? (
        <JsonResponseView data={parsed} className="run-detail-response-visual" enableRowSelection={false} />
      ) : (
        <CaptureCodeBlock
          fullText={display}
          language={showFormatToggle ? "json" : "plain"}
          hideToolbar
          jsonPretty={jsonPretty}
          onJsonPrettyChange={setJsonPretty}
          maxHeight="min(42vh, 380px)"
          ariaLabel="响应 JSON"
          className="run-detail-response-json-block"
        />
      )}
    </div>
  );
}