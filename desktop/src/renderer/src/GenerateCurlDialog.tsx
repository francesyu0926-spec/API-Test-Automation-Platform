import { useEffect, useMemo, useState } from "react";

import CaptureCodeBlock from "./CaptureCodeBlock";

type Props = {
  open: boolean;
  curlText: string;
  onCancel: () => void;
  onCopied?: () => void;
};

export default function GenerateCurlDialog({ open, curlText, onCancel, onCopied }: Props) {
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const canCopy = useMemo(() => Boolean(curlText.trim()) && !curlText.trim().startsWith("#"), [curlText]);

  useEffect(() => {
    if (!open) setCopyHint(null);
  }, [open]);

  if (!open) return null;

  const copy = async () => {
    if (!canCopy) return;
    try {
      await window.atp.copyText(curlText);
      setCopyHint("已复制到剪贴板");
      onCopied?.();
    } catch {
      try {
        await navigator.clipboard.writeText(curlText);
        setCopyHint("已复制到剪贴板");
        onCopied?.();
      } catch {
        setCopyHint("复制失败，请手动选择下方文本");
      }
    }
  };

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal-card modal-card--wide"
        role="dialog"
        aria-labelledby="generate-curl-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h4 id="generate-curl-title" className="modal-title">
          生成 cURL
        </h4>
        <p className="hint" style={{ marginBottom: 12 }}>
          根据当前请求（含环境变量替换后的 URL / Headers / Body）生成，可在终端或 DevTools 中复现。
        </p>
        <div className="curl-block" style={{ maxHeight: "min(52vh, 420px)", overflow: "auto", marginBottom: 12 }}>
          <CaptureCodeBlock fullText={curlText} language="curl" />
        </div>
        {copyHint ? (
          <p className="hint" style={{ marginBottom: 12 }}>
            {copyHint}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="nav-btn" onClick={onCancel}>
            关闭
          </button>
          <button type="button" className="primary" disabled={!canCopy} onClick={() => void copy()}>
            复制 cURL
          </button>
        </div>
      </div>
    </div>
  );
}