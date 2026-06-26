import React from "react";

type Props = { children: React.ReactNode; title?: string };
type State = { error: Error | null };

export class HqErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Headquarters render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="hq-shell" style={{ alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "2rem" }}>
          <div className="hq-panel" style={{ maxWidth: 520, padding: "1.5rem" }}>
            <h2 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>
              {this.props.title ?? "Headquarters failed to load"}
            </h2>
            <p style={{ color: "var(--hq-text-muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
              A dashboard component encountered an error. Try refreshing, or switch back to Standard View.
            </p>
            <pre style={{ fontSize: "0.75rem", color: "#ef4444", whiteSpace: "pre-wrap", marginBottom: "1rem" }}>
              {this.state.error.message}
            </pre>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" className="hq-btn hq-btn-primary" onClick={() => window.location.reload()}>
                Reload
              </button>
              <button
                type="button"
                className="hq-btn hq-btn-secondary"
                onClick={() => {
                  localStorage.setItem("ifcdc-hq-dashboard-mode", "standard");
                  window.location.href = "/hq";
                }}
              >
                Reset to Standard View
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

type WidgetBoundaryProps = { children: React.ReactNode; label?: string };
type WidgetBoundaryState = { error: Error | null };

/** Isolates a single dashboard widget so one bad KPI cannot crash /hq */
export class HqWidgetErrorBoundary extends React.Component<WidgetBoundaryProps, WidgetBoundaryState> {
  state: WidgetBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): WidgetBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Headquarters widget error:", this.props.label ?? "widget", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="hq-muted-text" style={{ fontSize: "0.8rem", color: "var(--hq-warning)" }}>
          {this.props.label ? `${this.props.label} unavailable` : "Widget unavailable"}
        </div>
      );
    }
    return this.props.children;
  }
}
