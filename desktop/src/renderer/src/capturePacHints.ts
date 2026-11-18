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

function hostMatchesProtected(bypassHost: string, protectedHost: string): boolean {
  const b = bypassHost.toLowerCase();
  const p = protectedHost.toLowerCase();
  if (b === p) return true;
  return b.endsWith(`.${p}`) || p.endsWith(`.${b}`);
}

/** 内嵌「直连」列表若含项目配置的 API 域，则请求不经 mitm */
export function embeddedBypassBlocksApiCapture(bypassInput: string, protectedHosts: string[]): string[] {
  if (!protectedHosts.length) return [];
  const bypass = parseHostListInput(bypassInput);
  return bypass.filter((h) => protectedHosts.some((p) => hostMatchesProtected(h, p)));
}