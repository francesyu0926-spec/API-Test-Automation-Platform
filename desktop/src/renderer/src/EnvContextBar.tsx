import type { ReactNode } from "react";

type Props = {
  envName: string;
  environments: string[];
  disabled?: boolean;
  onEnvChange: (name: string) => void;
  onOpenVars: () => void;
  onCreateEnv?: () => void;
  trailing?: ReactNode;
};

/** 模块内环境切换：与左侧全局「项目」分工，此处只选 env 与变量 */
export default function EnvContextBar({
  envName,
  environments,
  disabled,
  onEnvChange,
  onOpenVars,
  onCreateEnv,
  trailing,
}: Props) {
  return (
    <div className="env-context-bar" role="toolbar" aria-label="环境">
      <span className="env-context-bar-label">环境</span>
      <select
        className="workbench-topbar-control workbench-topbar-control--env"
        value={envName}
        disabled={disabled || !environments.length}
        onChange={(e) => onEnvChange(e.target.value)}
        aria-label="环境"
      >
        {environments.map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>
      {onCreateEnv ? (
        <button type="button" className="nav-btn" disabled={disabled} title="新建环境" onClick={onCreateEnv}>
          + 环境
        </button>
      ) : null}
      <button type="button" className="nav-btn" disabled={disabled} onClick={onOpenVars}>
        变量
      </button>
      {trailing}
    </div>
  );
}