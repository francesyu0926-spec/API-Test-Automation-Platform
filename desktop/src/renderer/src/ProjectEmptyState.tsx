type Props = {
  title?: string;
  hint: string;
  onCreateProject?: () => void;
  onGoProjects?: () => void;
};

export default function ProjectEmptyState({ title = "请先选择工作区", hint, onCreateProject, onGoProjects }: Props) {
  return (
    <section className="card panel-empty-card workspace-empty">
      <div className="panel-empty-state">
        <div className="panel-empty-icon" aria-hidden>
          ◇
        </div>
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