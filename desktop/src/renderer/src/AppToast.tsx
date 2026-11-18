import type { NotifyKind } from "./useAppNotify";

type Props = {
  text: string;
  kind: NotifyKind;
  onDismiss: () => void;
};

export default function AppToast({ text, kind, onDismiss }: Props) {
  return (
    <div
      className={`app-toast app-toast--global app-toast--${kind}`}
      role={kind === "error" ? "alert" : "status"}
      onClick={onDismiss}
    >
      <span className="app-toast-dot" aria-hidden />
      <span className="app-toast-text">{text}</span>
      <button
        type="button"
        className="app-toast-dismiss"
        aria-label="关闭通知"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
      >
        ×
      </button>
    </div>
  );
}