import { useEffect, useState } from "react";
import type { NotifyKind } from "./useAppNotify";

type Props = {
  onNotify: (text: string, kind?: NotifyKind) => void;
};

export default function CaptureRecordingBanner({ onNotify }: Props) {
  const [mitm, setMitm] = useState<Awaited<ReturnType<typeof window.atp.mitmStatus>>>({ running: false });
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const tick = async () => {
      try {
        setMitm(await window.atp.mitmStatus());
      } catch (err) {
        console.error("capture recording banner status", err);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => window.clearInterval(id);
  }, []);

  if (!mitm.running) return null;

  const proxy = mitm.proxy ?? `127.0.0.1:${mitm.listenPort ?? 8888}`;

  const stopAndRestore = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      const res = await window.atp.stopAllCapture(false);
      onNotify(res.message, "warn");
      setMitm(await window.atp.mitmStatus());
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "停止抓包失败", "error");
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="capture-recording-banner" role="status" aria-live="polite">
      <span className="capture-recording-banner-dot" aria-hidden />
      <p className="capture-recording-banner-text">
        正在录制系统流量（本地代理 {proxy} 已接管）——{" "}
        <button
          type="button"
          className="capture-recording-banner-action"
          disabled={stopping}
          onClick={() => void stopAndRestore()}
        >
          {stopping ? "正在停止…" : "点击一键停止并恢复网络"}
        </button>
      </p>
    </div>
  );
}