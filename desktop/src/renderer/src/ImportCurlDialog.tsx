import { useEffect, useState } from "react";

import { parseCurlToDraft } from "./curlImport";
import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";

type Props = {
  open: boolean;
  onCancel: () => void;
  onImport: (draft: WorkbenchDraft, warnings: string[]) => void;
};

export default function ImportCurlDialog({ open, onCancel, onImport }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setText("");
    setError("");
  }, [open]);

  if (!open) return null;

  const onSubmit = () => {
    const parsed = parseCurlToDraft(text);
    if (!parsed) {
      setError("无法解析 cURL，请粘贴完整 curl 命令或 URL");
      return;
    }
    onImport(parsed.draft, parsed.warnings);
  };

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal-card modal-card--wide"
        role="dialog"
        aria-labelledby="import-curl-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h4 id="import-curl-title" className="modal-title">
          导入 cURL
        </h4>
        <p className="modal-message" style={{ marginBottom: 12 }}>
          粘贴从浏览器 DevTools、Postman、抓包复制的 <code>curl …</code> 命令，将解析为工作台请求（支持{" "}
          <code>-X</code>、<code>-H</code>、<code>-d</code> / <code>--data-raw</code>、换行 <code>\</code>）。
          若含 <code>token</code> / <code>secret</code> / <code>terminalenv</code> 等头，将写入当前环境的{" "}
          <code>*.local.yaml</code>，并改为 <code>{`{{变量}}`}</code>。
        </p>
        <textarea
          className="workbench-body-textarea import-curl-textarea"
          spellCheck={false}
          placeholder={`curl -X POST 'https://api.example.com/foo' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"id":1}'`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError("");
          }}
        />
        {error && <p className="hint warn">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="nav-btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary" disabled={!text.trim()} onClick={onSubmit}>
            导入到工作台
          </button>
        </div>
      </div>
    </div>
  );
}