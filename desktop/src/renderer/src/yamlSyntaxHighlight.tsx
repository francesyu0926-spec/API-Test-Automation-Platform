import type { ReactNode } from "react";

function highlightYamlLine(line: string, li: number): ReactNode[] {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#")) {
    return [
      <span key={`${li}-cmt`} className="yaml-hl-comment">
        {line || "\u00a0"}
      </span>,
    ];
  }

  const parts: ReactNode[] = [];
  let last = 0;
  const re =
    /(#.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b-?\d+(?:\.\d+)?\b)|(\b(true|false|null|yes|no)\b)|(\b[A-Za-z_][\w-]*)(?=\s*:)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      parts.push(
        <span key={`${li}-p-${last}`} className="yaml-hl-plain">
          {line.slice(last, m.index)}
        </span>,
      );
    }
    const [full, comment, quoted, num, literal, key] = m;
    if (comment) {
      parts.push(
        <span key={`${li}-c-${m.index}`} className="yaml-hl-comment">
          {comment}
        </span>,
      );
    } else if (key) {
      parts.push(
        <span key={`${li}-k-${m.index}`} className="yaml-hl-key">
          {key}
        </span>,
      );
    } else if (quoted) {
      parts.push(
        <span key={`${li}-s-${m.index}`} className="yaml-hl-string">
          {quoted}
        </span>,
      );
    } else if (num) {
      parts.push(
        <span key={`${li}-n-${m.index}`} className="yaml-hl-number">
          {num}
        </span>,
      );
    } else if (literal) {
      parts.push(
        <span key={`${li}-l-${m.index}`} className="yaml-hl-literal">
          {literal}
        </span>,
      );
    } else {
      parts.push(
        <span key={`${li}-f-${m.index}`} className="yaml-hl-plain">
          {full}
        </span>,
      );
    }
    last = m.index + full.length;
  }
  if (last < line.length) {
    parts.push(
      <span key={`${li}-end`} className="yaml-hl-plain">
        {line.slice(last)}
      </span>,
    );
  }
  return parts.length ? parts : [<span key={`${li}-empty`} className="yaml-hl-plain">{"\u00a0"}</span>];
}

/** 轻量 YAML 高亮（键 / 字符串 / 注释） */
export function highlightYamlText(text: string): ReactNode[] {
  const lines = text.split("\n");
  return lines.map((line, li) => (
    <div key={li} className="run-detail-context-json-line">
      <span className="run-detail-context-json-ln" aria-hidden>
        {li + 1}
      </span>
      <span className="run-detail-context-json-code">{highlightYamlLine(line, li)}</span>
    </div>
  ));
}