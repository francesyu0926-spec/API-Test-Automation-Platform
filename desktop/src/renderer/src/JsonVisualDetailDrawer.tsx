import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export default function JsonVisualDetailDrawer({ title, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
  <div className="json-vis-drawer-root" role="presentation">
      <button type="button" className="json-vis-drawer-backdrop" aria-label="关闭" onClick={onClose} />
      <aside className="json-vis-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="json-vis-drawer-title">
        <header className="json-vis-drawer-head">
          <h3 id="json-vis-drawer-title" className="json-vis-drawer-title">
            {title}
          </h3>
          <button type="button" className="json-vis-drawer-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="json-vis-drawer-body">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}