import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; name?: string };
type State = { error: Error | null };

export default class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name ?? "panel"}]`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="card panel-empty-card workspace-empty">
          <div className="panel-empty-state">
            <p className="panel-empty-title">页面渲染异常</p>
            <p className="panel-empty-hint">{this.state.error.message}</p>
            <button type="button" className="primary" onClick={() => this.setState({ error: null })}>
              重试
            </button>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}