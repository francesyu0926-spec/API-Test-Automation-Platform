import { BrowserWindow, Menu, dialog, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const pdfWindows = new Set<BrowserWindow>();

export async function openPdfInNewTab(pdfPath: string): Promise<{ ok: boolean; error?: string }> {
  const resolved = path.resolve(pdfPath);
  try {
    await fs.access(resolved);
  } catch {
    return { ok: false, error: `PDF 不存在：${resolved}` };
  }
  try {
    const child = new BrowserWindow({
      width: 1120,
      height: 840,
      minWidth: 720,
      minHeight: 520,
      title: `PDF 预览 · ${path.basename(resolved)}`,
      backgroundColor: "#3e4348",
      autoHideMenuBar: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    pdfWindows.add(child);
    child.on("closed", () => pdfWindows.delete(child));

    const menu = Menu.buildFromTemplate([
      {
        label: "文件",
        submenu: [
          {
            label: "另存为…",
            accelerator: "CmdOrCtrl+S",
            click: async () => {
              const { canceled, filePath } = await dialog.showSaveDialog(child, {
                title: "另存为 PDF",
                defaultPath: resolved,
                filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
              });
              if (canceled || !filePath) return;
              await fs.copyFile(resolved, filePath);
            },
          },
          {
            label: "用系统默认程序打开",
            click: () => void shell.openPath(resolved),
          },
          { type: "separator" },
          { role: "close" },
        ],
      },
      {
        label: "查看",
        submenu: [
          { role: "reload" },
          { type: "separator" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "resetZoom" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "打印",
        submenu: [
          {
            label: "打印…",
            accelerator: "CmdOrCtrl+P",
            click: () => {
              child.webContents.print({ silent: false, printBackground: true }, (success, failure) => {
                if (!success && failure) {
                  void dialog.showMessageBox(child, {
                    type: "warning",
                    message: `打印失败：${failure}`,
                  });
                }
              });
            },
          },
        ],
      },
    ]);
    child.setMenu(menu);

    await child.loadURL(pathToFileURL(resolved).href);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}