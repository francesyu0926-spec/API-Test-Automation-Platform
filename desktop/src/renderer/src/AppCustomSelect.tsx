import { useEffect, useRef, useState } from "react";

export type AppSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
};

type Variant = "sidebar" | "method" | "control" | "inline";

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: AppSelectOption[];
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  variant?: Variant;
  showCheck?: boolean;
  panelMinWidth?: number;
};

const TRIGGER_CLASS: Record<Variant, string> = {
  sidebar: "workbench-custom-select-trigger",
  method: "app-custom-select-trigger--method",
  control: "capture-custom-picker-trigger capture-control-field text-input",
  inline: "workbench-custom-select-trigger app-custom-select-trigger--inline",
};

/** 系统通用暗色下拉（与集合模块一致）；环境栏 EnvContextBar 单独样式，不在此组件内 */
export default function AppCustomSelect({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
  title,
  placeholder,
  className,
  triggerClassName,
  variant = "sidebar",
  showCheck = true,
  panelMinWidth,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const triggerLabel = selected?.label ?? placeholder ?? "—";
  const pickerDisabled = disabled || (!options.length && !placeholder);

  return (
    <div
      className={`app-custom-select capture-custom-picker app-custom-select--${variant}${className ? ` ${className}` : ""}`}
      ref={rootRef}
    >
      <button
        type="button"
        className={`${TRIGGER_CLASS[variant]}${triggerClassName ? ` ${triggerClassName}` : ""}`}
        disabled={pickerDisabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        title={title ?? selected?.title ?? selected?.label ?? placeholder}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="capture-custom-picker-trigger-text">{triggerLabel}</span>
        <span className="capture-custom-picker-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div
          className="capture-custom-picker-panel app-custom-select-panel"
          role="listbox"
          aria-label={ariaLabel}
          style={panelMinWidth != null ? { minWidth: panelMinWidth } : undefined}
        >
          {options.length ? (
            options.map((opt) => {
              const active = opt.value === value;
              return (
                <button
                  key={`${opt.value}:${opt.label}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={opt.disabled}
                  title={opt.title ?? opt.label}
                  className={`capture-custom-picker-option${active ? " capture-custom-picker-option--active" : ""}`}
                  onClick={() => {
                    if (opt.disabled) return;
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <span className="capture-custom-picker-option-label">{opt.label}</span>
                  {showCheck && active ? (
                    <span className="capture-custom-picker-check" aria-hidden>
                      ✓
                    </span>
                  ) : null}
                </button>
              );
            })
          ) : (
            <div className="capture-custom-picker-option capture-custom-picker-option--empty" role="presentation">
              <span className="capture-custom-picker-option-label">{placeholder ?? "暂无选项"}</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}