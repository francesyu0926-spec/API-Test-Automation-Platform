import type { ReactNode } from "react";

function highlightCurlLine(line: string, li: number): ReactNode[] {
  const trimmed = line.trimStart();
  if (!trimmed) {
    return [
      <span key={`${li}-empty`} className="curl-hl-plain">
        {"\u00a0"}
      </span>,
    ];
  }

  if (/^\s*\\?\s*$/.test(line) && trimmed === "\\") {
    return [
      <span key={`${li}-cont`} className="curl-hl-flag">
        \
      </span>,
    ];
  }

  const parts: ReactNode[] = [];
  let last = 0;
  const re =
    /(\bcurl\b)|(-X|--request|-H|--header|-d|--data|-b|--cookie|-u|--user|-A|--user-agent|-e|--referer)\b|('https?:\/\/[^']*'|"https?:\/\/[^"]*"|https?:\/\/\S+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      const chunk = line.slice(last, m.index);
      parts.push(...highlightHeaderValues(chunk, li, last));
      last = m.index;
    }
    const [full, cmd, flag, url] = m;
    if (cmd) {
      parts.push(
        <span key={`${li}-cmd-${m.index}`} className="curl-hl-cmd">
          {cmd}
        </span>,
      );
    } else if (flag) {
      parts.push(
        <span key={`${li}-flg-${m.index}`} className="curl-hl-flag">
          {flag}
        </span>,
      );
    } else if (url) {
      parts.push(
        <span key={`${li}-url-${m.index}`} className="curl-hl-url">
          {url}
        </span>,
      );
    } else {
      parts.push(
        <span key={`${li}-f-${m.index}`} className="curl-hl-plain">
          {full}
        </span>,
      );
    }
    last = m.index + full.length;
  }
  if (last < line.length) {
    parts.push(...highlightHeaderValues(line.slice(last), li, last));
  }
  return parts.length ? parts : [<span key={`${li}-p`} className="curl-hl-plain">{line}</span>];
}

/** `-H 'Name: value'` 中 header 名 / 值分色 */
function highlightHeaderValues(chunk: string, li: number, offset: number): ReactNode[] {
  const quoted = chunk.match(/^(\s*)('([^']+)')/);
  if (!quoted) {
    return [
      <span key={`${li}-t-${offset}`} className="curl-hl-plain">
        {chunk}
      </span>,
    ];
  }
  const [, lead, full, inner] = quoted;
  const colon = inner.indexOf(":");
  const parts: ReactNode[] = [];
  if (lead) {
    parts.push(
      <span key={`${li}-l-${offset}`} className="curl-hl-plain">
        {lead}
      </span>,
    );
  }
  parts.push(
    <span key={`${li}-q1-${offset}`} className="curl-hl-plain">
      '
    </span>,
  );
  if (colon >= 0) {
    const name = inner.slice(0, colon);
    const rest = inner.slice(colon);
    parts.push(
      <span key={`${li}-hk-${offset}`} className="curl-hl-hkey">
        {name}
      </span>,
    );
    parts.push(
      <span key={`${li}-hv-${offset}`} className="curl-hl-hval">
        {rest}
      </span>,
    );
  } else {
    parts.push(
      <span key={`${li}-hs-${offset}`} className="curl-hl-string">
        {inner}
      </span>,
    );
  }
  parts.push(
    <span key={`${li}-q2-${offset}`} className="curl-hl-plain">
      '
    </span>,
  );
  const tail = chunk.slice(quoted[0].length);
  if (tail) {
    parts.push(
      <span key={`${li}-tail-${offset}`} className="curl-hl-plain">
        {tail}
      </span>,
    );
  }
  return parts;
}

export function highlightCurlText(text: string): ReactNode[] {
  const lines = text.split("\n");
  return lines.map((line, li) => (
    <div key={li} className="run-detail-context-json-line">
      <span className="run-detail-context-json-ln" aria-hidden>
        {li + 1}
      </span>
      <span className="run-detail-context-json-code">{highlightCurlLine(line, li)}</span>
    </div>
  ));
}