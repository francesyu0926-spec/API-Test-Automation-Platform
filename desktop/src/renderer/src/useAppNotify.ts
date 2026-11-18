import { useCallback, useRef, useState } from "react";

export type NotifyKind = "info" | "success" | "warn" | "error";

export type AppToastState = {
  text: string;
  kind: NotifyKind;
};

export function useAppNotify(timeoutMs = 3600) {
  const [toast, setToast] = useState<AppToastState | null>(null);
  const timer = useRef<number | null>(null);

  const clearToast = useCallback(() => {
    setToast(null);
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const notify = useCallback(
    (text: string, kind: NotifyKind = "info") => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setToast({ text: trimmed, kind });
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setToast(null);
        timer.current = null;
      }, kind === "error" ? timeoutMs + 1200 : timeoutMs);
    },
    [timeoutMs],
  );

  return { toast, notify, clearToast };
}