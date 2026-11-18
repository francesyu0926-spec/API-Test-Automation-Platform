import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[App]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const preloadHint =
        !window.atp &&
        "未检测到 window.atp：请关闭本页，在 desktop 目录运行 npm run dev，使用弹出的 Electron 窗口（不要用浏览器打开 localhost）。";
      return (
        <div className="app-error-fallback">
          <h1>界面加载失败</h1>
          <p>{this.state.error.message}</p>
          {preloadHint ? <p className="hint">{preloadHint}</p> : null}
          <button
            type="button"
            className="primary"
            onClick={() => {
              if (!window.atp) window.location.reload();
              else this.setState({ error: null });
            }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}