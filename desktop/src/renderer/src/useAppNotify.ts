import { useCallback, useRef, useState } from "react";

export function useAppNotify(timeoutMs = 2800) {
  const [toast, setToast] = useState("");
  const timer = useRef<number | null>(null);

  const notify = useCallback(
    (text: string) => {
      setToast(text);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setToast(""), timeoutMs);
    },
    [timeoutMs],
  );

  return { toast, notify, clearToast: () => setToast("") };
}