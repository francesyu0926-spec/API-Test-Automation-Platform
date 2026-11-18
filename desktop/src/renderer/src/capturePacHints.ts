/** 南财终端常见 API 主机（PAC 模式：仅这些走 mitm） */
export const NANCAI_TERMINAL_PAC_HOSTS =
  "terminal.sfccn.com,sfccn.com,cfic.sfccn.com,vftc.sfccn.com";

function tokenToHost(token: string): string {
  let t = token.trim();
  if (!t) return "";
  if (!/^https?:\/\//i.test(t)) {
    t = `http://${t}`;
  }
  try {
    return new URL(t).hostname.toLowerCase();
  } catch {
    return token
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split(/[/?#]/)[0]
      .replace(/:\d+$/, "");
  }
}

export function parseHostListInput(input: string): string[] {
  const parts = input.split(/[,;\n]+/).flatMap((chunk) => chunk.split(/\s+/));
  return [...new Set(parts.map(tokenToHost).filter(Boolean))];
}

/** 内嵌模式的「直连」列表里若含业务 API 域，则请求不会出现在抓包列表 */
export function embeddedBypassBlocksApiCapture(input: string): string[] {
  const hosts = parseHostListInput(input);
  return hosts.filter((h) => /(^|\.)sfccn\.com$/i.test(h));
}