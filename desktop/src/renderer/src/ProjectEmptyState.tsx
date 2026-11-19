type Props = {
  title?: string;
  hint: string;
  onCreateProject?: () => void;
  onGoProjects?: () => void;
  /** 工作台主区：全屏居中无卡片 */
  fullscreen?: boolean;
};

function WorkspaceEmptyIcon({ code }: { code?: boolean }) {
  return (
    <div
      className={`workspace-empty-hero-icon${code ? " workspace-empty-hero-icon--code" : ""}`}
      aria-hidden
    >
      {code ? (
        <span className="workspace-empty-hero-glyphs">&lt;/&gt;</span>
      ) : (
        <svg className="panel-empty-icon-svg" viewBox="0 0 48 48" focusable="false">
          <path
            d="M10 14h14l6 6v22a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V16a2 2 0 0 1 2-2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <path
            d="M24 14v6h6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <path d="M24 30v8M20 34h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}

export default function ProjectEmptyState({
  title = "请先选择工作区",
  hint,
  onCreateProject,
  onGoProjects,
  fullscreen = false,
}: Props) {
  const useFullscreen = fullscreen && !onGoProjects;

  if (useFullscreen) {
    return (
      <section className="workspace-empty-full" aria-labelledby="workspace-empty-title">
        <WorkspaceEmptyIcon code />
        <h2 id="workspace-empty-title" className="workspace-empty-full-title">
          {title}
        </h2>
        <p className="workspace-empty-full-hint">{hint}</p>
        {onCreateProject ? (
          <button type="button" className="primary workspace-empty-full-cta" onClick={onCreateProject}>
            + 新建项目
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section className="card panel-empty-card workspace-empty">
      <div className="panel-empty-state">
        <WorkspaceEmptyIcon />
        <p className="panel-empty-title">{title}</p>
        <p className="panel-empty-hint">{hint}</p>
        <div className="workspace-empty-actions">
          {onCreateProject ? (
            <button type="button" className="primary" onClick={onCreateProject}>
              新建项目
            </button>
          ) : null}
          {onGoProjects ? (
            <button type="button" className="nav-btn" onClick={onGoProjects}>
              打开「项目与用例」
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}