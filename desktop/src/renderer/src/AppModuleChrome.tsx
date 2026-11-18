import type { ReactNode } from "react";

import { APP_TABS, TAB_DESCRIPTIONS, type AppTab } from "./navConfig";

type Props = {
  tab: AppTab;
  /** 覆盖默认副标题；传 `false` 则不显示副标题 */
  description?: string | false;
  /** 副标题与主标题同一行（不占第二行，适配 64px 页头） */
  descriptionInline?: boolean;
  actions?: ReactNode;
  showShortcut?: boolean;
  /** 附加在 header 上的 class */
  className?: string;
  /** 纯文本快捷键提示（不占 badge，避免右侧裁切） */
  shortcutPlain?: boolean;
};

export default function AppModuleChrome({
  tab,
  description,
  descriptionInline = false,
  actions,
  showShortcut = true,
  className,
  shortcutPlain = false,
}: Props) {
  const meta = APP_TABS.find((t) => t.id === tab);
  if (!meta) return null;
  const desc =
    description === false ? null : description !== undefined ? description : TAB_DESCRIPTIONS[tab];

  const chromeClass = ["app-module-chrome", className].filter(Boolean).join(" ");

  return (
    <header className={chromeClass} aria-label={`${meta.label}模块`}>
      <div className="app-module-chrome-text">
        <h2 className="app-module-chrome-title">{meta.label}</h2>
        {desc && descriptionInline ? (
          <span className="app-module-chrome-meta hint" title={desc}>
            {desc}
          </span>
        ) : desc ? (
          <p className="app-module-chrome-desc">{desc}</p>
        ) : null}
      </div>
      <div className="app-module-chrome-aside">
        {actions}
        {showShortcut ? (
          shortcutPlain ? (
            <span className="app-module-chrome-kbd app-module-chrome-kbd--plain hint">Alt+{meta.shortcut}</span>
          ) : (
            <span className="app-module-chrome-kbd hint">
              <kbd>Alt+{meta.shortcut}</kbd> 切换
            </span>
          )
        ) : null}
      </div>
    </header>
  );
}