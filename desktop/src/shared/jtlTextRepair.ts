function countCjk(s: string): number {
  return (s.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

/** UTF-8 字节被按 Latin-1 展开后的典型乱码特征 */
export function looksLikeUtf8Mojibake(s: string): boolean {
  if (!s || countCjk(s) > 0) return false;
  return /(?:Ã.|Â.|æ.|ç.|è.|é.|ê.|å.|ä.|ö.|ü.|ÿ.|Ÿ|¤|ï»¿)/.test(s);
}

/** 将当前字符串按 Latin-1 取字节后再按 UTF-8 解码 */
export function latin1BytesToUtf8(text: string): string {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * 修复 JTL 文本字段（responseMessage / failureMessage / label 等）的常见乱码。
 * 不破坏已是正常中文的字符串。
 */
export function repairJtlTextField(raw: string): string {
  const t = raw ?? "";
  if (!t) return t;

  const origCjk = countCjk(t);
  const mojibake = looksLikeUtf8Mojibake(t);

  if (origCjk > 0 && !mojibake) return t;

  const fromLatin = latin1BytesToUtf8(t);
  const latinCjk = countCjk(fromLatin);
  if (latinCjk > origCjk && !fromLatin.includes("\uFFFD")) {
    return fromLatin;
  }

  if (mojibake && latinCjk >= origCjk) return fromLatin;

  return t;
}

/** 失败样本用于 Dashboard / 错误汇总的展示文案 */
export function jtlSampleErrorMessage(sample: {
  responseCode: string;
  responseMessage: string;
  failureMessage?: string;
}): string {
  const fail = repairJtlTextField((sample.failureMessage ?? "").trim());
  const resp = repairJtlTextField(sample.responseMessage.trim());
  const code = sample.responseCode.trim();

  if (fail) {
    if (code && !fail.startsWith(code)) return `${code} ${fail}`.trim();
    return fail;
  }

  const joined = [code, resp].filter(Boolean).join(" ").trim();
  return joined || "failure";
}