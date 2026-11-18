/** 工作台元数据行：分组 / 保存目标（与 RunsHistoryTable 内联 SVG 风格一致） */

export function WorkbenchGroupFolderIcon() {
  return (
    <svg className="workbench-meta-pick-svg" width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2h-7l-2-2z"
      />
    </svg>
  );
}

export function WorkbenchSaveCollectionIcon() {
  return (
    <svg className="workbench-meta-pick-svg" width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-1 12H5V8h14v10zM7 10h10v1.5H7V10zm0 3h10V14.5H7V13z"
      />
    </svg>
  );
}