type SaveBytesOpts = {
  defaultPath?: string;
  base64: string;
  filters?: Array<{ name: string; extensions: string[] }>;
};

type SaveBytesResult = { ok: boolean; filePath?: string; cancelled?: boolean; error?: string };

function fileNameFromDefaultPath(defaultPath?: string): string {
  if (!defaultPath?.trim()) return "export.bin";
  const normalized = defaultPath.replace(/\\/g, "/");
  const base = normalized.split("/").pop();
  return base?.trim() || "export.bin";
}

function mimeFromFilters(filters?: SaveBytesOpts["filters"]): string {
  const ext = filters?.[0]?.extensions?.[0]?.toLowerCase();
  if (ext === "xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (ext === "png") return "image/png";
  return "application/octet-stream";
}

/** 优先走主进程另存为；preload 未热更新时回退为浏览器下载 */
export async function saveBytesWithDialog(opts: SaveBytesOpts): Promise<SaveBytesResult> {
  const invoke = window.atp?.saveBytesWithDialog;
  if (typeof invoke === "function") {
    return invoke(opts);
  }

  try {
    const binary = atob(opts.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeFromFilters(opts.filters) });
    const url = URL.createObjectURL(blob);
    const name = fileNameFromDefaultPath(opts.defaultPath);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return {
      ok: true,
      filePath: name,
      error:
        "主进程 saveBytes 未就绪，已触发浏览器下载。请完全关闭并重启桌面端后可用「另存为」对话框。",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}