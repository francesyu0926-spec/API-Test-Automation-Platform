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
      return (
        <div className="app-error-fallback">
          <h1>界面加载失败</h1>
          <p>{this.state.error.message}</p>
          <button type="button" className="primary" onClick={() => this.setState({ error: null })}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}