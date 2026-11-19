import { useMemo, useRef } from "react";

import { formatJsonBody } from "./apiWorkbenchModel";
import { highlightJsonText } from "./jsonSyntaxHighlight";

type Props = {
  value: string;
  onChange: (next: string) => void;
  onToast?: (text: string) => void;
};

export default function LoadTestSamplerBodyEditor({ value, onChange, onToast }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const lineCount = useMemo(() => Math.max(1, value.split("\n").length), [value]);
  const highlighted = useMemo(() => highlightJsonText(value || " "), [value]);

  const syncScroll = () => {
    const ta = taRef.current;
    const hl = highlightRef.current;
    if (!ta || !hl) return;
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  };

  const onFormat = () => {
    const formatted = formatJsonBody(value);
    if (formatted !== value) {
      onChange(formatted);
      onToast?.("已格式化 JSON");
    } else {
      onToast?.(value.trim() ? "JSON 无法解析，未改动" : "请求体为空");
    }
  };

  const onCopy = async () => {
    try {
      await window.atp.copyText(value);
      onToast?.("已复制请求体");
    } catch {
      try {
        await navigator.clipboard.writeText(value);
        onToast?.("已复制请求体");
      } catch {
        onToast?.("复制失败");
      }
    }
  };

  return (
    <div className="loadtest-sampler-body-block">
      <div className="loadtest-sampler-body-head">
        <span className="loadtest-sampler-field-label loadtest-sampler-field-label--body">
          请求体 <span className="loadtest-sampler-field-tag">(Body)</span>
        </span>
        <div className="loadtest-sampler-body-tools" role="toolbar" aria-label="请求体工具">
          <button
            type="button"
            className="loadtest-sampler-body-tool"
            title="格式化 JSON"
            aria-label="格式化 JSON"
            onClick={onFormat}
          >
            <SamplerBodyToolIcon kind="format" />
          </button>
          <button
            type="button"
            className="loadtest-sampler-body-tool"
            title="复制到剪贴板"
            aria-label="复制请求体"
            onClick={() => void onCopy()}
          >
            <SamplerBodyToolIcon kind="copy" />
          </button>
          <button
            type="button"
            className="loadtest-sampler-body-tool"
            title="从 JSON 文件导入"
            aria-label="从文件导入 JSON"
            onClick={() => fileRef.current?.click()}
          >
            <SamplerBodyToolIcon kind="import" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json,text/plain"
            className="loadtest-sampler-body-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void file.text().then((text) => {
                onChange(text);
                onToast?.(`已导入 ${file.name}`);
              });
            }}
          />
        </div>
      </div>
      <div className="loadtest-sampler-body-editor-host">
        <div ref={gutterRef} className="loadtest-sampler-body-ln-gutter" aria-hidden>
          {Array.from({ length: lineCount }, (_, i) => (
            <span key={i} className="loadtest-sampler-body-ln">
              {i + 1}
            </span>
          ))}
        </div>
        <div className="loadtest-sampler-body-editor-stack">
          <div
            ref={highlightRef}
            className="loadtest-sampler-body-highlight capture-code-block-scroll"
            aria-hidden
          >
            <pre className="capture-code-block-pre">{highlighted}</pre>
          </div>
          <textarea
            ref={taRef}
            className="loadtest-sampler-body-input"
            value={value}
            spellCheck={false}
            placeholder='例如 {"key": "value"} — 无正文可留空'
            title="无正文可留空"
            onChange={(e) => onChange(e.target.value)}
            onScroll={syncScroll}
          />
        </div>
      </div>
    </div>
  );
}

function SamplerBodyToolIcon({ kind }: { kind: "format" | "copy" | "import" }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "format") {
    return (
      <svg className="loadtest-sampler-body-tool-icon" aria-hidden {...common}>
        <path d="M8 6c-2.5 0-4 2-4 5s1.5 5 4 5M16 6c2.5 0 4 2 4 5s-1.5 5-4 5" />
        <path d="M9 11h6M9 15h4" />
      </svg>
    );
  }
  if (kind === "copy") {
    return (
      <svg className="loadtest-sampler-body-tool-icon" aria-hidden {...common}>
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    );
  }
  return (
    <svg className="loadtest-sampler-body-tool-icon" aria-hidden {...common}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}