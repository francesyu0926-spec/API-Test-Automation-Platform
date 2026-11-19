import { SkeletonLine } from "./AppSkeleton";

type Props = {
  /** workbench-style vs generic */
  layout?: "workbench" | "plain";
};

export default function WorkspaceBootSkeleton({ layout = "workbench" }: Props) {
  return (
    <div className="workspace-boot-skeleton" role="status" aria-busy="true" aria-label="加载工作台">
      {layout === "workbench" ? (
        <>
          <div className="workspace-boot-skeleton-chrome">
            <SkeletonLine width="120px" height={14} />
            <SkeletonLine width="200px" height={12} />
          </div>
          <div className="workspace-boot-skeleton-url">
            <SkeletonLine width="72px" height={36} />
            <SkeletonLine width="100%" height={36} />
            <SkeletonLine width="88px" height={36} />
          </div>
          <div className="workspace-boot-skeleton-panes">
            <div className="workspace-boot-skeleton-aside">
              <SkeletonLine width="100%" height={12} />
              <SkeletonLine width="92%" height={12} />
              <SkeletonLine width="84%" height={12} />
              <SkeletonLine width="78%" height={12} />
              <SkeletonLine width="88%" height={12} />
            </div>
            <div className="workspace-boot-skeleton-main">
              <SkeletonLine width="40%" height={12} />
              <SkeletonLine width="100%" height={140} />
              <SkeletonLine width="100%" height={120} />
            </div>
          </div>
        </>
      ) : (
        <div className="workspace-boot-skeleton-plain">
          <SkeletonLine width="min(420px, 70%)" height={16} />
          <SkeletonLine width="min(520px, 85%)" height={12} />
          <SkeletonLine width="min(480px, 80%)" height={12} />
          <SkeletonLine width="min(360px, 60%)" height={220} />
        </div>
      )}
    </div>
  );
}