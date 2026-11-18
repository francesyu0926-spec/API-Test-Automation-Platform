import type { MouseEvent as ReactMouseEvent } from "react";

export const JSON_DATA_COL_DEFAULT_PX = 112;
export const JSON_DATA_COL_MIN_PX = 56;
export const JSON_DATA_COL_MAX_PX = 520;

export function clampColumnWidth(px: number): number {
  return Math.min(JSON_DATA_COL_MAX_PX, Math.max(JSON_DATA_COL_MIN_PX, Math.round(px)));
}

/** 在列头分隔条上按下后开始拖拽调整宽度（document 级监听，释放时清理）。 */
export function startJsonColumnResize(
  event: ReactMouseEvent,
  startWidthPx: number,
  onWidth: (nextPx: number) => void,
): void {
  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;
  let lastWidth = startWidthPx;

  const onMove = (ev: MouseEvent) => {
    const next = clampColumnWidth(startWidthPx + ev.clientX - startX);
    if (next !== lastWidth) {
      lastWidth = next;
      onWidth(next);
    }
  };

  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.classList.remove("json-vis-col-resizing");
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  };

  document.body.classList.add("json-vis-col-resizing");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}