type Props = {
  show: boolean;
  label?: string;
  /** 仅占据父容器（父级需 position: relative） */
  block?: boolean;
};

export default function LoadingOverlay({ show, label = "加载中…", block = true }: Props) {
  if (!show) return null;
  return (
    <div
      className={`loading-overlay${block ? " loading-overlay--block" : ""}`}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="loading-spinner" aria-hidden />
      <span className="loading-label">{label}</span>
    </div>
  );
}