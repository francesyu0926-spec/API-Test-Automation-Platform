import { useMemo } from "react";

import CaptureCodeBlock from "./CaptureCodeBlock";

type Props = {
  value: string;
  onChange: (value: string) => void;
  maxHeight?: string;
  onCopied?: (message: string) => void;
  ariaLabel?: string;
};

export default function YamlHighlightEditor({
  value,
  onChange,
  maxHeight = "min(200px, 28vh)",
  onCopied,
  ariaLabel = "编辑 YAML",
}: Props) {
  const lineCount = useMemo(() => value.split("\n").length, [value]);
  const rows = Math.min(16, Math.max(6, lineCount));

  return (
    <div className="yaml-highlight-editor">
      <label className="yaml-highlight-editor-edit-wrap">
        <span className="hint yaml-highlight-editor-label">编辑（下方为语法高亮预览）</span>
        <textarea
          className="yaml-highlight-editor-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          rows={rows}
          aria-label={ariaLabel}
        />
      </label>
      <CaptureCodeBlock
        fullText={value}
        language="yaml"
        maxHeight={maxHeight}
        onCopied={onCopied}
        ariaLabel="YAML 预览"
      />
    </div>
  );
}