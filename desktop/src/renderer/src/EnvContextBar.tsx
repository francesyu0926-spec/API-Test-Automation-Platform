import { useEffect, useRef, useState, type ReactNode } from "react";

import { envIndicatorDotClass } from "./envIndicator";

type Props = {
  envName: string;
  environments: string[];
  disabled?: boolean;
  onEnvChange: (name: string) => void;
  onOpenVars: () => void;
  onCreateEnv?: () => void;
  trailing?: ReactNode;
};

/** 模块内环境切换：紧凑下拉 + 快捷图标 */
export default function EnvContextBar({
  envName,
  environments,
  disabled,
  onEnvChange,
  onOpenVars,
  onCreateEnv,
  trailing,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pickerDisabled = disabled || !environments.length;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="env-context-bar env-context-bar--compact" role="toolbar" aria-label="环境">
      <div className="env-context-bar-group">
        <div className="env-context-picker capture-custom-picker" ref={rootRef}>
          <button
            type="button"
            className="env-context-picker-trigger"
            disabled={pickerDisabled}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-label="环境"
            title="当前运行环境"
            onClick={() => setOpen((v) => !v)}
          >
            <span
              className={envIndicatorDotClass(envName)}
              aria-hidden
              title={`环境：${envName || "未选择"}`}
            />
            <span className="env-context-picker-label">{envName || "—"}</span>
            <span className="capture-custom-picker-chevron" aria-hidden>
              ▾
            </span>
          </button>
          {open ? (
            <div className="env-context-picker-panel capture-custom-picker-panel" role="listbox" aria-label="环境列表">
              {environments.map((name) => {
                const active = name === envName;
                return (
                  <button
                    key={name}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`capture-custom-picker-option env-context-picker-option${active ? " capture-custom-picker-option--active" : ""}`}
                    onClick={() => {
                      onEnvChange(name);
                      setOpen(false);
                    }}
                  >
                    <span className={envIndicatorDotClass(name)} aria-hidden />
                    <span className="capture-custom-picker-option-label">{name}</span>
                    {active ? (
                      <span className="capture-custom-picker-check" aria-hidden>
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        {onCreateEnv ? (
          <button
            type="button"
            className="workbench-icon-btn workbench-icon-btn--tiny env-context-icon-btn"
            disabled={disabled}
            title="新建环境"
            aria-label="新建环境"
            onClick={onCreateEnv}
          >
            +
          </button>
        ) : null}
        <button
          type="button"
          className="workbench-icon-btn workbench-icon-btn--tiny workbench-icon-btn--muted env-context-icon-btn"
          disabled={disabled}
          title="环境变量"
          aria-label="环境变量"
          onClick={onOpenVars}
        >
          ⚙
        </button>
      </div>
      {trailing}
    </div>
  );
}