import { APP_TABS, TAB_DESCRIPTIONS, type AppTab } from "./navConfig";

type Props = {
  tab: AppTab;
  projectId?: string;
  projectName?: string;
};

export default function AppModuleChrome({ tab, projectId, projectName }: Props) {
  const meta = APP_TABS.find((t) => t.id === tab);
  if (!meta) return null;
  const label = projectName?.trim() || projectId;

  return (
    <header className="app-module-chrome" aria-label={`${meta.label}模块`}>
      <div className="app-module-chrome-text">
        <h2 className="app-module-chrome-title">{meta.label}</h2>
        <p className="app-module-chrome-desc">{TAB_DESCRIPTIONS[tab]}</p>
      </div>
      <div className="app-module-chrome-aside">
        {label ? (
          <span className="app-module-context-chip" title={projectId}>
            {label}
          </span>
        ) : null}
        <span className="app-module-chrome-kbd hint">
          <kbd>Alt+{meta.shortcut}</kbd> 切换
        </span>
      </div>
    </header>
  );
}