import type { ReactNode } from "react";

const KEYWORDS = new Set([
  "function",
  "return",
  "const",
  "let",
  "var",
  "if",
  "else",
  "new",
  "typeof",
  "throw",
  "try",
  "catch",
  "finally",
  "async",
  "await",
  "true",
  "false",
  "null",
  "undefined",
  "this",
  "instanceof",
  "of",
  "in",
]);

const GLOBALS = new Set(["pm", "console", "JSON", "Math", "Date", "Object", "Array"]);

function classForWord(word: string): string {
  if (KEYWORDS.has(word)) return "js-hl-keyword";
  if (GLOBALS.has(word)) return "js-hl-global";
  if (/^\d+(?:\.\d+)?$/.test(word)) return "js-hl-number";
  return "js-hl-plain";
}

function highlightJsLine(line: string, lineKey: number): ReactNode[] {
  const parts: ReactNode[] = [];
  let i = 0;
  let partIdx = 0;
  const push = (text: string, cls: string) => {
    if (!text) return;
    parts.push(
      <span key={`${lineKey}-${partIdx++}`} className={cls}>
        {text}
      </span>,
    );
  };

  while (i < line.length) {
    const rest = line.slice(i);
    if (rest.startsWith("//")) {
      push(rest, "js-hl-comment");
      break;
    }
    const ch = line[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "\\" && j + 1 < line.length) {
          j += 2;
          continue;
        }
        if (line[j] === ch) {
          j += 1;
          break;
        }
        j += 1;
      }
      push(line.slice(i, j), "js-hl-string");
      i = j;
      continue;
    }
    if (/[{}();,.[\]]/.test(ch)) {
      push(ch, "js-hl-punct");
      i += 1;
      continue;
    }
    const wordM = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (wordM) {
      const word = wordM[0];
      const nextIdx = i + word.length;
      const isCall = line[nextIdx] === "(";
      if (isCall && !KEYWORDS.has(word) && !GLOBALS.has(word)) {
        push(word, "js-hl-fn");
      } else {
        push(word, classForWord(word));
      }
      i = nextIdx;
      continue;
    }
    push(ch, "js-hl-plain");
    i += 1;
  }

  return parts;
}

/** Postman / pm 脚本轻量 JavaScript 高亮 */
export function highlightJsText(text: string): ReactNode[] {
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    const parts = highlightJsLine(line, li);
    nodes.push(
      <div key={li} className="run-detail-context-json-line">
        <span className="run-detail-context-json-ln" aria-hidden>
          {li + 1}
        </span>
        <span className="run-detail-context-json-code">
          {parts.length ? parts : "\u00a0"}
        </span>
      </div>,
    );
  }
  if (!nodes.length) {
    nodes.push(
      <div key={0} className="run-detail-context-json-line">
        <span className="run-detail-context-json-ln" aria-hidden>
          1
        </span>
        <span className="run-detail-context-json-code">
          <span className="js-hl-plain">{"\u00a0"}</span>
        </span>
      </div>,
    );
  }
  return nodes;
}