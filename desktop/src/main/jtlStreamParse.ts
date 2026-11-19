import fs from "node:fs";
import fsp from "node:fs/promises";
import readline from "node:readline";

import iconv from "iconv-lite";

import {
  buildJtlColumnIndex,
  parseCsvLine,
  parseJtlSampleFromCells,
} from "../shared/jtl";
import {
  createJtlStreamAggregator,
  type JtlStreamAggregateResult,
} from "../shared/jtlStreamAggregator";
import { jtlStreamOptionsForMode, type JtlStreamModeId } from "../shared/jtlStreamModes";

import { detectJtlFileEncoding } from "./jtlFileEncoding";

/** 流式读取 JTL（CSV），避免整文件读入内存。 */
export type JtlParseProgress = { rows: number };

export async function aggregateJtlFile(
  filePath: string,
  mode?: JtlStreamModeId | null,
  onProgress?: (progress: JtlParseProgress) => void,
): Promise<JtlStreamAggregateResult> {
  const agg = createJtlStreamAggregator(jtlStreamOptionsForMode(mode));
  let colIndex: Map<string, number> | null = null;

  const fileEncoding = await detectJtlFileEncoding(filePath);
  const raw = fs.createReadStream(filePath, { highWaterMark: 256 * 1024 });
  const stream =
    fileEncoding === "utf8" ? raw.setEncoding("utf8") : raw.pipe(iconv.decodeStream("gb18030"));
  const rl = readline.createInterface({
    input: stream as NodeJS.ReadableStream,
    crlfDelay: Infinity,
  });

  let dataRows = 0;
  let lastProgressAt = 0;

  try {
    for await (const rawLine of rl) {
      const line = rawLine.replace(/^\uFEFF/, "");
      if (!line.trim()) continue;
      const cells = parseCsvLine(line);
      if (!colIndex) {
        const header = cells.map((c) => c.trim());
        colIndex = buildJtlColumnIndex(header);
        agg.noteHeader(header);
        continue;
      }
      const sample = parseJtlSampleFromCells(cells, colIndex);
      if (sample) agg.push(sample);
      dataRows += 1;
      if (onProgress && dataRows - lastProgressAt >= 2500) {
        lastProgressAt = dataRows;
        onProgress({ rows: dataRows });
      }
    }
    onProgress?.({ rows: dataRows });
  } finally {
    rl.close();
    stream.destroy();
  }

  return agg.finalize();
}

export const JTL_STREAM_RECOMMENDED_BYTES = 32 * 1024 * 1024;

export async function shouldStreamJtlFile(filePath: string): Promise<boolean> {
  try {
    const st = await fsp.stat(filePath);
    return st.size > JTL_STREAM_RECOMMENDED_BYTES;
  } catch {
    return true;
  }
}