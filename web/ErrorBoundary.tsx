import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[UI]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card" style={{ margin: "2rem auto", maxWidth: 520 }}>
          <h2>Something went wrong</h2>
          <p className="error mono">{this.state.error.message}</p>
          <button
            className="btn"
            type="button"
            onClick={() => {
              this.setState({ error: null });
              window.location.href = "/";
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
