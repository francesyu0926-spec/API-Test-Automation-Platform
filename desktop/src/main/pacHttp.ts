import http from "node:http";

let server: http.Server | null = null;

export async function startPacHttpServer(pacBody: string, port = 8766): Promise<{ ok: boolean; url?: string; error?: string }> {
  await stopPacHttpServer();
  return new Promise((resolve) => {
    const s = http.createServer((_req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/x-ns-proxy-autoconfig",
        "Cache-Control": "no-cache",
      });
      res.end(pacBody);
    });
    s.on("error", (e) => resolve({ ok: false, error: String(e) }));
    s.listen(port, "127.0.0.1", () => {
      server = s;
      resolve({ ok: true, url: `http://127.0.0.1:${port}/proxy.pac` });
    });
  });
}

export function stopPacHttpServer(): Promise<void> {
  if (!server) return Promise.resolve();
  const s = server;
  server = null;
  return new Promise((resolve) => s.close(() => resolve()));
}