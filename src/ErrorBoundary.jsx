import { Component } from "react";

// App-wide error boundary. Before this, ANY render-time throw (e.g. a bad
// timeclock entry crashing the Time Clock page) blanked the whole app to a
// white screen with no clue why. Now the error + component stack are shown on
// screen and logged to the console, and the user can recover without a hard
// refresh losing their place.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Keep the full stack in the console for diagnosis.
    console.error("App crashed:", error, info?.componentStack);
  }

  handleReset = () => this.setState({ error: null, info: null });

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ minHeight: "100vh", background: "#0b0f17", color: "#e6edf3", fontFamily: "system-ui, sans-serif", padding: "40px 24px", boxSizing: "border-box" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Something went wrong</div>
          <div style={{ fontSize: 14, color: "#9aa7b5", marginBottom: 20 }}>
            The page hit an error and stopped rendering. The details below help pinpoint the cause.
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
            <button onClick={this.handleReset} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "#2f81f7", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Try again</button>
            <button onClick={() => window.location.reload()} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #30363d", background: "transparent", color: "#e6edf3", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Reload app</button>
          </div>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, fontSize: 12, color: "#ff7b72", overflow: "auto", maxHeight: "30vh" }}>
            {String(error?.stack || error)}
          </pre>
          {info?.componentStack && (
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, fontSize: 12, color: "#9aa7b5", overflow: "auto", maxHeight: "30vh", marginTop: 12 }}>
              {info.componentStack}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
