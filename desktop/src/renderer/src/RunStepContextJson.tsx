import { useMemo, useState } from "react";

import { highlightJsonText } from "./jsonSyntaxHighlight";

type Props = {
  step: Record<string, unknown>;
};

export default function RunStepContextJson({ step }: Props) {
  const [open, setOpen] = useState(false);
  const [pretty, setPretty] = useState(true);
  const [search, setSearch] = useState("");

  const text = useMemo(
    () => (pretty ? JSON.stringify(step, null, 2) : JSON.stringify(step)),
    [pretty, step],
  );

  const highlighted = useMemo(() => highlightJsonText(text, search), [text, search]);

  const onCopy = async () => {
    try {
      if (window.atp?.copyText) {
        await window.atp.copyText(text);
      } else {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className={`run-detail-context-json${open ? " run-detail-context-json--open" : ""}`}>
      <button
        type="button"
        className="run-detail-context-json-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`run-detail-context-json-chevron${open ? " run-detail-context-json-chevron--open" : ""}`} aria-hidden />
        <span className="run-detail-context-json-label">请求与执行上下文 (Raw)</span>
        <span className="hint run-detail-context-json-hint">含 method、URL、headers、时间等，非上方响应体</span>
      </button>
      {open ? (
        <div className="run-detail-context-json-panel">
          <div className="run-detail-context-json-toolbar">
            <button type="button" className="nav-btn nav-btn--compact nav-btn--ghost" onClick={() => void onCopy()}>
              复制
            </button>
            <button
              type="button"
              className="nav-btn nav-btn--compact nav-btn--ghost"
              onClick={() => setPretty((v) => !v)}
              title={pretty ? "切换为压缩一行" : "切换为格式化"}
            >
              {pretty ? "压缩" : "格式化"}
            </button>
            <label className="run-detail-context-json-search">
              <input
                type="search"
                className="text-input run-detail-context-json-search-input"
                placeholder="搜索关键字"
                aria-label="在 JSON 中搜索"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
          <div className="run-detail-context-json-scroll" tabIndex={0}>
            <pre className="run-detail-context-json-pre" aria-label="完整步骤 JSON">
              {highlighted}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}