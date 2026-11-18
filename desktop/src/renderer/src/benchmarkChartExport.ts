import { inlineSvgCssVars } from "./chartColors";

/** 将已渲染的 SVG 转为 PNG data URL，供 PDF 嵌入 */
export async function svgToPngDataUrl(svg: SVGSVGElement, scale = 2): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const w = svg.width.baseVal.value || svg.clientWidth || 400;
  const h = svg.height.baseVal.value || svg.clientHeight || 228;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  inlineSvgCssVars(clone);
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    return await new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas"));
          return;
        }
        ctx.fillStyle = "#141414";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("svg 转图片失败"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function capturePerfChartImages(root: ParentNode): Promise<{
  latencyPng?: string;
  statusPng?: string;
}> {
  const panels = root.querySelectorAll(".perf-charts-grid .perf-chart-panel svg.perf-chart-svg");
  const latencySvg = panels[0] as SVGSVGElement | undefined;
  const statusSvg = panels[1] as SVGSVGElement | undefined;
  const out: { latencyPng?: string; statusPng?: string } = {};
  if (latencySvg?.querySelector("g")) {
    out.latencyPng = await svgToPngDataUrl(latencySvg);
  }
  if (statusSvg?.querySelector("g, path")) {
    out.statusPng = await svgToPngDataUrl(statusSvg);
  }
  return out;
}