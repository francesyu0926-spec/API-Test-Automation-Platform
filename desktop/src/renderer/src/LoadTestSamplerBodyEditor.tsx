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
          <button type="button" className="loadtest-sampler-body-tool" title="格式化 JSON" onClick={onFormat}>
            ✨ 格式化
          </button>
          <button
            type="button"
            className="loadtest-sampler-body-tool"
            title="复制到剪贴板"
            onClick={() => void onCopy()}
          >
            📋 复制
          </button>
          <button
            type="button"
            className="loadtest-sampler-body-tool"
            title="从 JSON 文件导入"
            onClick={() => fileRef.current?.click()}
          >
            ⬆ 导入
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