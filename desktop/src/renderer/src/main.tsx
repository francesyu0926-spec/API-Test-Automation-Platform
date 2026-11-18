import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AppErrorBoundary from "./AppErrorBoundary";
import "./styles.css";

const rootEl = document.getElementById("root");

function renderPreloadMissing() {
  const msg =
    "未检测到 Electron 预加载接口（window.atp）。请勿在浏览器中打开 http://localhost:5173；" +
    "请在 desktop 目录执行 npm run dev，使用自动弹出的「API Test Automation」窗口。";
  if (rootEl) {
    rootEl.innerHTML = `<pre class="app-error-fallback" style="padding:24px;max-width:520px;margin:40px auto;color:#d1d5db;line-height:1.6;white-space:pre-wrap"><strong style="color:#e8c489;font-size:18px;display:block;margin:0 0 12px">无法在浏览器中运行</strong>${msg}</pre>`;
  } else {
    document.body.innerHTML = `<pre style="padding:24px;color:#c00;">${msg}</pre>`;
  }
}

if (!rootEl) {
  document.body.innerHTML =
    '<pre style="padding:24px;color:#c00;">#root 未找到，请重新构建 desktop 应用。</pre>';
} else if (!window.atp) {
  renderPreloadMissing();
} else {
  ReactDOM.createRoot(rootEl).render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>,
  );
}