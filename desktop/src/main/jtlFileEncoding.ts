import fsp from "node:fs/promises";

import iconv from "iconv-lite";

const SAMPLE_BYTES = 96 * 1024;

export type JtlFileEncoding = "utf8" | "gb18030";

/** 根据文件头判断 JTL 文本编码（常见为 UTF-8 或 GBK 导出的 CSV）。 */
export async function detectJtlFileEncoding(filePath: string): Promise<JtlFileEncoding> {
  let buf: Buffer;
  try {
    const fh = await fsp.open(filePath, "r");
    try {
      const { buffer } = await fh.read({ length: SAMPLE_BYTES, position: 0 });
      buf = buffer;
    } finally {
      await fh.close();
    }
  } catch {
    return "utf8";
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return "utf8";
  }

  const utf8 = buf.toString("utf8");
  if (utf8.includes("\uFFFD")) return "gb18030";

  const gbk = iconv.decode(buf, "gb18030");
  const han = (s: string) => (s.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const gbkHan = han(gbk);
  const utf8Han = han(utf8);
  if (gbkHan > utf8Han + 2) return "gb18030";

  const mojibake = /(?:Ã.|Â.|æ.|ç.|è.|é.|å.|Ÿ|¤)/.test(utf8);
  if (mojibake && gbkHan > utf8Han) return "gb18030";

  const latinFixed = Buffer.from(utf8, "latin1").toString("utf8");
  const fixedHan = han(latinFixed);
  if (mojibake && fixedHan > utf8Han + 2) return "utf8";

  return "utf8";
}