import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const tmpDir = app.getPath("temp");
  const tmpHtml = path.join(tmpDir, `atp-perf-${Date.now()}.html`);
  await fs.writeFile(tmpHtml, html, "utf8");

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
    },
  });

  try {
    await win.loadFile(tmpHtml);
    await win.webContents.executeJavaScript(
      `new Promise((resolve) => {
        const imgs = document.images;
        if (!imgs.length) { resolve(); return; }
        let pending = imgs.length;
        const done = () => { if (--pending <= 0) resolve(); };
        for (const img of imgs) {
          if (img.complete) done();
          else { img.onload = done; img.onerror = done; }
        }
      })`,
    );
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { marginType: "default" },
    });
    return Buffer.from(data);
  } finally {
    win.destroy();
    await fs.unlink(tmpHtml).catch(() => undefined);
  }
}