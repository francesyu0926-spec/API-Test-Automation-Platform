import { useCallback, useEffect, useRef, useState } from "react";

import LoadingOverlay from "./LoadingOverlay";
import { emptyRow } from "./apiWorkbenchModel";
import type { KeyValueRow } from "../../shared/apiWorkbenchTypes";
import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import { templateVarNamesInDraft } from "../../shared/vars";
import { coalesceAuthVariables, mergeAuthFromSampler } from "./samplerAuth";

type Props = {
  open: boolean;
  project: string;
  envName: string;
  variableNames: string[];
  /** 打开时用请求头中的鉴权补足未保存的变量（如 Header 里已有 Bearer） */
  sampler?: WorkbenchDraft;
  onCancel: () => void;
  onSaved: () => void;
};

function looksSecretKey(key: string): boolean {
  const k = key.trim().toLowerCase();
  if (!k) return false;
  return (
    k === "token" ||
    k === "secret" ||
    k.includes("password") ||
    k.includes("passwd") ||
    k.includes("secret") ||
    k.includes("token") ||
    k.includes("jwt") ||
    k.includes("credential") ||
    k.includes("api_key") ||
    k.includes("apikey") ||
    k === "key" ||
    k.endsWith("_key") ||
    (k.includes("key") && (k.includes("api") || k.includes("private") || k.includes("access")))
  );
}

function EnvRevealIcon({ hidden }: { hidden: boolean }) {
  if (hidden) {
    return (
      <svg className="env-vars-reveal-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M2 4.27 3.28 3 20 19.72 18.73 21l-2.43-2.43A11.78 11.78 0 0 1 12 19.5C6.48 19.5 1.73 15.89 1 12a13.4 13.4 0 0 1 3.27-4.42L2 4.27ZM12 5c2.95 0 5.6 1.26 7.54 3.27l-1.42 1.42A8.96 8.96 0 0 0 12 7c-2.06 0-3.96.7-5.48 1.87L5.07 7.43A10.94 10.94 0 0 1 12 5Zm0 14c-2.95 0-5.6-1.26-7.54-3.27l1.42-1.42A8.96 8.96 0 0 0 12 17c2.06 0 3.96-.7 5.48-1.87l1.45 1.44A10.94 10.94 0 0 1 12 19Z"
        />
      </svg>
    );
  }
  return (
    <svg className="env-vars-reveal-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 5C6.48 5 1.73 8.61 1 12c.73 3.89 4.48 7.5 11 7.5s10.27-3.61 11-7.5c-.73-3.39-5.48-7-11-7Zm0 12.5c-3.04 0-5.47-1.77-6.6-4.5 1.13-2.73 3.56-4.5 6.6-4.5s5.47 1.77 6.6 4.5c-1.13 2.73-3.56 4.5-6.6 4.5Zm0-7.5a3 3 0 1 0 .001 6.001A3 3 0 0 0 12 10Z"
      />
    </svg>
  );
}

export default function EnvVariablesDialog({
  open,
  project,
  envName,
  variableNames,
  sampler,
  onCancel,
  onSaved,
}: Props) {
  const [rows, setRows] = useState<KeyValueRow[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revealValue, setRevealValue] = useState<Record<number, boolean>>({});
  const keyRefs = useRef<(HTMLInputElement | null)[]>([]);
  const valueRefs = useRef<(HTMLInputElement | null)[]>([]);
  const pendingFocusKey = useRef<number | null>(null);

  const wantedKeysKey = [...new Set(variableNames.map((n) => n.trim()).filter(Boolean))]
    .sort()
    .join("\u0001");
  const wantedKeys = wantedKeysKey ? wantedKeysKey.split("\u0001") : [];

  const addRow = useCallback(() => {
    setRows((r) => {
      pendingFocusKey.current = r.length;
      return [...r, emptyRow()];
    });
  }, []);

  const focusKeyAt = useCallback((index: number) => {
    window.requestAnimationFrame(() => {
      keyRefs.current[index]?.focus();
    });
  }, []);

  useEffect(() => {
    if (pendingFocusKey.current == null) return;
    const i = pendingFocusKey.current;
    pendingFocusKey.current = null;
    focusKeyAt(i);
  }, [rows.length, focusKeyAt]);

  const removeRow = useCallback((index: number) => {
    setRows((list) => {
      if (list.length <= 1) {
        return list.map((r, j) => (j === index ? emptyRow() : r));
      }
      return list.filter((_, j) => j !== index);
    });
    setRevealValue((m) => {
      const next: Record<number, boolean> = {};
      for (const [key, val] of Object.entries(m)) {
        const i = Number(key);
        if (i < index) next[i] = val;
        else if (i > index) next[i - 1] = val;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setRevealValue((m) => {
      const next = { ...m };
      for (let i = 0; i < rows.length; i++) {
        if (!looksSecretKey(rows[i].key) || !rows[i].value.trim()) {
          delete next[i];
        }
      }
      return next;
    });
  }, [rows]);

  const loadGenRef = useRef(0);
  const samplerRef = useRef(sampler);
  samplerRef.current = sampler;

  useEffect(() => {
    if (!open || !project) return;
    const gen = ++loadGenRef.current;
    const samplerSnap = samplerRef.current;
    void (async () => {
      setLoading(true);
      try {
        const vars = await window.atp.getProjectVariables(project, envName);
        if (gen !== loadGenRef.current) return;
        const merged = coalesceAuthVariables(
          samplerSnap ? mergeAuthFromSampler(vars, samplerSnap) : vars,
        );
        const list: KeyValueRow[] = wantedKeys.map((key) => ({
          key,
          value: merged[key] ?? "",
          enabled: true,
        }));
        setRows(list.length ? list : [emptyRow()]);
        setRevealValue({});
        setError("");
      } catch (err) {
        if (gen === loadGenRef.current) {
          setError(err instanceof Error ? err.message : "加载变量失败");
          setRows(wantedKeys.length ? wantedKeys.map((key) => ({ key, value: "", enabled: true })) : [emptyRow()]);
        }
      } finally {
        if (gen === loadGenRef.current) setLoading(false);
      }
    })();
  }, [open, project, envName, wantedKeysKey]);

  const onSave = async () => {
    if (!project) return;
    const current = await window.atp.getProjectVariables(project, envName);
    const variables: Record<string, string> = {};
    for (const [k, v] of Object.entries(current)) {
      if (k === "project") continue;
      variables[k] = v;
    }
    for (const row of rows) {
      if (!row.key.trim()) continue;
      variables[row.key.trim()] = row.value;
    }
    const coalesced = coalesceAuthVariables(variables);
    setSaving(true);
    const res = await window.atp.saveProjectEnvLocal(project, envName, coalesced);
    setSaving(false);
    if (!res.ok) {
      setError("保存失败");
      return;
    }
    onSaved();
  };

  if (!open) return null;

  const yamlPath = `environments/${envName}.local.yaml`;

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal-card modal-card--wide env-vars-dialog"
        role="dialog"
        aria-labelledby="env-vars-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="env-vars-dialog-head">
          <h4 id="env-vars-title" className="modal-title env-vars-dialog-title">
            环境变量 · {envName}
          </h4>
          <button
            type="button"
            className="workbench-icon-btn workbench-icon-btn--muted env-vars-dialog-close"
            aria-label="关闭"
            title="关闭"
            onClick={onCancel}
          >
            ×
          </button>
        </div>

        <aside className="env-vars-callout" aria-label="说明">
          <p className="env-vars-callout-line">
            <span className="env-vars-callout-emoji" aria-hidden>
              🔒
            </span>
            仅保存于本地配置文件 <code className="env-vars-callout-code">{yamlPath}</code>
            <span className="env-vars-git-tag">不提交 Git</span>
            ，当前项目共用。
          </p>
          <p className="env-vars-callout-line env-vars-callout-line--tip">
            <span className="env-vars-callout-emoji" aria-hidden>
              💡
            </span>
            变量名包含敏感词（如{" "}
            <span className="env-vars-callout-kw-group">
              <code className="env-vars-callout-code">token</code>
              <span className="env-vars-callout-kw-sep">, </span>
              <code className="env-vars-callout-code">password</code>
            </span>
            ）时，右侧值将自动隐藏，点击值框右侧眼睛图标可切换查看。
          </p>
        </aside>

        <div className="env-vars-form loading-host">
          <LoadingOverlay show={loading} label="加载变量…" />
          <div className="env-vars-col-labels">
            <span>变量</span>
            <span>值</span>
            <span className="env-vars-col-spacer" aria-hidden />
          </div>
          <div className="env-vars-scroll">
            <div className="env-vars-rows">
              {rows.map((row, i) => {
                const secret = looksSecretKey(row.key);
                const showReveal = secret && row.value.trim().length > 0;
                const masked = showReveal && !revealValue[i];
                const valuePlaceholder = secret
                  ? "JWT / 密钥（可与另一项相同）"
                  : "例: https://dev.api.com";

                const rowFilled = Boolean(row.key.trim() || row.value.trim());

                return (
                  <div
                    key={`env-row-${i}`}
                    className={`env-vars-row${rowFilled ? " env-vars-row--filled" : ""}`}
                  >
                    <input
                      ref={(el) => {
                        keyRefs.current[i] = el;
                      }}
                      className="text-input env-vars-input"
                      value={row.key}
                      placeholder="例: base_url"
                      aria-label={`变量名 ${i + 1}`}
                      onChange={(e) =>
                        setRows((list) =>
                          list.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)),
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          valueRefs.current[i]?.focus();
                        }
                      }}
                    />
                    <div className="env-vars-value-wrap">
                      <input
                        ref={(el) => {
                          valueRefs.current[i] = el;
                        }}
                        className={`text-input env-vars-input env-vars-input--value${
                          showReveal ? " env-vars-input--value-reveal" : ""
                        }`}
                        type={masked ? "password" : "text"}
                        value={row.value}
                        placeholder={valuePlaceholder}
                        aria-label={`变量值 ${i + 1}`}
                        autoComplete={secret ? "off" : undefined}
                        onChange={(e) =>
                          setRows((list) =>
                            list.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)),
                          )
                      }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            addRow();
                          }
                        }}
                      />
                      {showReveal ? (
                        <button
                          type="button"
                          className="env-vars-reveal-btn"
                          aria-label={revealValue[i] ? "隐藏值" : "显示值"}
                          title={revealValue[i] ? "隐藏" : "显示"}
                          onClick={() => setRevealValue((m) => ({ ...m, [i]: !m[i] }))}
                        >
                          <EnvRevealIcon hidden={Boolean(revealValue[i])} />
                        </button>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="env-vars-row-del"
                      aria-label={`删除第 ${i + 1} 行`}
                      title={rows.length <= 1 ? "清空此行" : "删除此行"}
                      onClick={() => removeRow(i)}
                    >
                      <span aria-hidden>🗑</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <button type="button" className="env-vars-add-dashed" onClick={addRow}>
            + 添加一行
          </button>
        </div>

        {error ? <p className="hint warn env-vars-error">{error}</p> : null}

        <div className="modal-actions env-vars-dialog-actions">
          <button type="button" className="nav-btn env-vars-action-btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="primary env-vars-action-btn"
            disabled={saving}
            onClick={() => void onSave()}
          >
            {saving ? "保存中…" : "保存并应用"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function collectTemplateVarNames(draft: {
  url: string;
  query: { value: string }[];
  headers: { value: string }[];
  body: string;
}): string[] {
  return templateVarNamesInDraft(draft);
}