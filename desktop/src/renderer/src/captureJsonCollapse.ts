/** 折叠 JSON 中指定 key 的对象块（仅用于展示，复制仍用完整文本） */
export function collapseJsonObjectKeys(pretty: string, keys: Set<string>): string {
  const lines = pretty.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const m = line.match(/^(\s*)"([^"]+)":\s*\{\s*$/);
    if (m && keys.has(m[2]!)) {
      const indent = m[1]!;
      const key = m[2]!;
      let depth = 1;
      i++;
      let keyCount = 0;
      while (i < lines.length && depth > 0) {
        const l = lines[i]!;
        if (/^\s*"[^"]+":/.test(l)) keyCount += 1;
        for (const ch of l) {
          if (ch === "{") depth += 1;
          else if (ch === "}") depth -= 1;
        }
        if (depth === 0) break;
        i++;
      }
      out.push(`${indent}"${key}": { /* …${keyCount || "多"} 项，取消下方「折叠 headers」后展开 */ }`);
      i++;
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
}