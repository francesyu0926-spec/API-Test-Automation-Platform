import type { ReactNode } from "react";

/** 轻量 JSON 高亮（键 / 字符串 / 数字 / 布尔） */
export function highlightJsonText(text: string, searchQuery?: string): ReactNode[] {
  const q = searchQuery?.trim().toLowerCase();
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    const lineHidden = q && !line.toLowerCase().includes(q);
    if (lineHidden) continue;

    const parts: ReactNode[] = [];
    const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(true|false|null)\b/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) {
        parts.push(
          <span key={`${li}-t-${last}`} className="json-hl-plain">
            {line.slice(last, m.index)}
          </span>,
        );
      }
      const [full, quoted, colon, num, literal] = m;
      if (quoted && colon) {
        parts.push(
          <span key={`${li}-k-${m.index}`} className="json-hl-key">
            {quoted}
          </span>,
        );
        parts.push(
          <span key={`${li}-c-${m.index}`} className="json-hl-plain">
            {colon}
          </span>,
        );
      } else if (quoted) {
        parts.push(
          <span key={`${li}-s-${m.index}`} className="json-hl-string">
            {quoted}
          </span>,
        );
      } else if (num) {
        parts.push(
          <span key={`${li}-n-${m.index}`} className="json-hl-number">
            {num}
          </span>,
        );
      } else if (literal) {
        parts.push(
          <span key={`${li}-l-${m.index}`} className="json-hl-literal">
            {literal}
          </span>,
        );
      } else {
        parts.push(
          <span key={`${li}-f-${m.index}`} className="json-hl-plain">
            {full}
          </span>,
        );
      }
      last = m.index + full.length;
    }
    if (last < line.length) {
      parts.push(
        <span key={`${li}-end`} className="json-hl-plain">
          {line.slice(last)}
        </span>,
      );
    }

    nodes.push(
      <div key={li} className="run-detail-context-json-line">
        <span className="run-detail-context-json-ln" aria-hidden>
          {li + 1}
        </span>
        <span className="run-detail-context-json-code">{parts.length ? parts : "\u00a0"}</span>
      </div>,
    );
  }

  if (q && nodes.length === 0) {
    return [
      <p key="empty" className="hint run-detail-context-json-empty">
        无匹配「{searchQuery}」的行
      </p>,
    ];
  }

  return nodes;
}