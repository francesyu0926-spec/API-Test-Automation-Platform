/** SVG 栅格化时不含页面 CSS，轴文字须使用已解析的实色 */
export type ChartColors = {
  muted: string;
  text: string;
  border: string;
  accent: string;
};

const FALLBACK: ChartColors = {
  muted: "#8b95a8",
  text: "#d1d5db",
  border: "#283142",
  accent: "#c48e4d",
};

export function resolveChartColors(): ChartColors {
  if (typeof document === "undefined") return FALLBACK;
  const s = getComputedStyle(document.documentElement);
  return {
    muted: s.getPropertyValue("--muted").trim() || FALLBACK.muted,
    text: s.getPropertyValue("--text").trim() || FALLBACK.text,
    border: s.getPropertyValue("--border-soft").trim() || FALLBACK.border,
    accent: s.getPropertyValue("--accent-strong").trim() || FALLBACK.accent,
  };
}

/** 导出 PNG 前把 SVG 属性中的 var() 换成实色 */
export function inlineSvgCssVars(svg: SVGSVGElement): void {
  const c = resolveChartColors();
  const map: Record<string, string> = {
    "var(--muted)": c.muted,
    "var(--text)": c.text,
    "var(--border-soft)": c.border,
    "var(--accent-strong)": c.accent,
  };
  const walk = (el: Element) => {
    for (const attr of ["fill", "stroke", "color"]) {
      const v = el.getAttribute(attr);
      if (v && map[v]) el.setAttribute(attr, map[v]);
    }
    for (const child of el.children) walk(child);
  };
  walk(svg);
}