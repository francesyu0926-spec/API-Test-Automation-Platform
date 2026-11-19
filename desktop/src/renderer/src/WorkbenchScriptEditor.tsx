import { useMemo, useRef } from "react";

import { highlightJsText } from "./jsSyntaxHighlight";

type Props = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
};

export default function WorkbenchScriptEditor({ value, onChange, placeholder, ariaLabel }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lineCount = useMemo(() => Math.max(1, value.split("\n").length), [value]);
  const highlighted = useMemo(() => highlightJsText(value || " "), [value]);

  const syncScroll = () => {
    const ta = taRef.current;
    const hl = highlightRef.current;
    if (!ta || !hl) return;
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  };

  return (
    <div className="workbench-script-code-editor">
      <div className="workbench-script-code-editor-host loadtest-sampler-body-editor-host">
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
            className="loadtest-sampler-body-highlight capture-code-block-scroll workbench-script-code-highlight"
            aria-hidden
          >
            <pre className="capture-code-block-pre">{highlighted}</pre>
          </div>
          <textarea
            ref={taRef}
            className="loadtest-sampler-body-input workbench-script-code-input"
            value={value}
            spellCheck={false}
            placeholder={placeholder}
            aria-label={ariaLabel}
            onChange={(e) => onChange(e.target.value)}
            onScroll={syncScroll}
          />
        </div>
      </div>
    </div>
  );
}