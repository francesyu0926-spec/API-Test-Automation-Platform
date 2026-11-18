import { JTL_STREAM_MODES, type JtlStreamModeId } from "../../shared/jtlStreamModes";
import AppCustomSelect from "./AppCustomSelect";

type Props = {
  value: JtlStreamModeId;
  onChange: (mode: JtlStreamModeId) => void;
  disabled?: boolean;
  compact?: boolean;
  /** 紧凑顶栏由外部「解析:」标注时可关闭内置标签 */
  showFieldLabel?: boolean;
};

export default function JtlStreamModeField({
  value,
  onChange,
  disabled,
  compact,
  showFieldLabel = true,
}: Props) {
  const active = JTL_STREAM_MODES.find((m) => m.id === value) ?? JTL_STREAM_MODES[0];

  return (
    <label className={`jtl-stream-mode-field${compact ? " jtl-stream-mode-field--compact" : ""}`}>
      {showFieldLabel ? <span className="jtl-stream-mode-label">JTL 解析</span> : null}
      <AppCustomSelect
        className="jtl-stream-mode-select"
        variant="inline"
        value={value}
        disabled={disabled}
        title={`${active.hint}。${active.useCase}`}
        ariaLabel="JTL 解析模式"
        options={JTL_STREAM_MODES.map((m) => ({
          value: m.id,
          label: `${m.label}（${m.limitLabel}）`,
          title: `${m.hint}。${m.useCase}`,
        }))}
        panelMinWidth={280}
        onChange={(id) => onChange(id as JtlStreamModeId)}
      />
      {!compact ? (
        <span className="hint jtl-stream-mode-hint" title={active.useCase}>
          {active.hint}
        </span>
      ) : null}
    </label>
  );
}