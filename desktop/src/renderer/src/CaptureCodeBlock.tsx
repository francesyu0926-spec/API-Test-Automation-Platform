import { useMemo, useState } from "react";

import { collapseJsonObjectKeys } from "./captureJsonCollapse";
import { highlightJsonText } from "./jsonSyntaxHighlight";
import { highlightCurlText } from "./curlSyntaxHighlight";
import { highlightYamlText } from "./yamlSyntaxHighlight";

type Props = {
  /** 完整内容（复制 / 格式化始终基于此） */
  fullText: string;
  language: "json" | "yaml" | "curl" | "plain";
  /** JSON 时默认折叠 request/response 下的 headers */
  collapseHeaderKeys?: boolean;
  maxHeight?: string;
  ariaLabel?: string;
  className?: string;
  /** 为 true 时不渲染内置工具栏（由父级统一顶栏） */
  hideToolbar?: boolean;
  /** 受控 JSON 是否格式化（与 hideToolbar 联用时由父级驱动） */
  jsonPretty?: boolean;
  onJsonPrettyChange?: (pretty: boolean) => void;
  onCopied?: (message: string) => void;
};

export default function CaptureCodeBlock({
  fullText,
  language,
  collapseHeaderKeys = false,
  maxHeight = "min(42vh, 380px)",
  ariaLabel = "代码",
  className = "",
  hideToolbar = false,
  jsonPretty,
  onJsonPrettyChange,
  onCopied,
}: Props) {
  const [prettyInternal, setPrettyInternal] = useState(true);
  const pretty = jsonPretty ?? prettyInternal;
  const [foldHeaders, setFoldHeaders] = useState(collapseHeaderKeys);

  const canonical = useMemo(() => {
    if (language !== "json") return fullText;
    try {
      const parsed = JSON.parse(fullText);
      return pretty ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
    } catch {
      return fullText;
    }
  }, [fullText, language, pretty]);

  const displayText = useMemo(() => {
    if (language !== "json" || !foldHeaders || !pretty) return canonical;
    return collapseJsonObjectKeys(canonical, new Set(["headers"]));
  }, [canonical, foldHeaders, language, pretty]);

  const highlighted = useMemo(() => {
    if (language === "json") return highlightJsonText(displayText);
    if (language === "yaml") return highlightYamlText(canonical);
    if (language === "curl") return highlightCurlText(fullText);
    if (language === "plain") return highlightPlainLines(fullText);
    return null;
  }, [canonical, displayText, fullText, language]);

  const onCopy = async () => {
    try {
      await window.atp.copyText(canonical);
      onCopied?.("已复制到剪贴板");
    } catch {
      try {
        await navigator.clipboard.writeText(canonical);
        onCopied?.("已复制到剪贴板");
      } catch {
        onCopied?.("复制失败");
      }
    }
  };

  const onFormat = () => {
    if (language !== "json") return;
    const next = !pretty;
    if (onJsonPrettyChange) onJsonPrettyChange(next);
    else setPrettyInternal(next);
  };

  return (
    <div className={`capture-code-block${className ? ` ${className}` : ""}${hideToolbar ? " capture-code-block--no-toolbar" : ""}`}>
      {hideToolbar ? null : (
      <div className="capture-code-block-toolbar">
        <div className="capture-code-block-toolbar-start">
          {language === "json" && collapseHeaderKeys && pretty ? (
            <label className="capture-code-block-check">
              <input
                type="checkbox"
                checked={foldHeaders}
                onChange={(e) => setFoldHeaders(e.target.checked)}
              />
              折叠 headers
            </label>
          ) : null}
        </div>
        <div className="capture-code-block-toolbar-end">
          <button
            type="button"
            className={`capture-code-copy-btn${language !== "plain" ? " capture-code-copy-btn--labeled" : ""}`}
            title="复制"
            aria-label="复制"
            onClick={() => void onCopy()}
          >
            <CaptureCopyClipIcon />
            {language !== "plain" ? <span>复制</span> : null}
          </button>
          {language === "json" ? (
            <button
              type="button"
              className="nav-btn nav-btn--compact nav-btn--ghost"
              onClick={onFormat}
              title={pretty ? "压缩为一行" : "格式化缩进"}
            >
              {pretty ? "压缩" : "✨ 格式化"}
            </button>
          ) : null}
        </div>
      </div>
      )}
      <div className="capture-code-block-scroll" style={{ maxHeight }} tabIndex={0}>
        {highlighted ? (
          <pre className="capture-code-block-pre" aria-label={ariaLabel}>
            {highlighted}
          </pre>
        ) : (
          <pre className="capture-code-block-pre capture-code-block-pre--plain" aria-label={ariaLabel}>
            {fullText}
          </pre>
        )}
      </div>
    </div>
  );
}

function highlightPlainLines(text: string) {
  return text.split("\n").map((line, li) => (
    <div key={li} className="run-detail-context-json-line">
      <span className="run-detail-context-json-ln" aria-hidden>
        {li + 1}
      </span>
      <span className="run-detail-context-json-code">
        <span className="json-hl-plain">{line || "\u00a0"}</span>
      </span>
    </div>
  ));
}

function CaptureCopyClipIcon() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M5.5 2.75A1.25 1.25 0 0 1 6.75 1.5h5.5A1.25 1.25 0 0 1 13.5 2.75V9.5A1.25 1.25 0 0 1 12.25 10.75h-1.1v.5A1.25 1.25 0 0 1 9.9 12.5h-5.5A1.25 1.25 0 0 1 3.15 11.25V4.5A1.25 1.25 0 0 1 4.4 3.25h1.1v-.5Zm1.25 0v.5h5.5V2.75h-5.5ZM4.4 4.5v6.75h5.5V4.5H4.4Z"
      />
    </svg>
  );
}