import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

/**
 * Enterprise Liquid-Glass Error Boundary Component.
 * 
 * Rationale:
 * React 19 unmounts the entire root tree upon encountering an unhandled render exception.
 * In a desktop environment (Tauri / WebView2), this leads to a blank screen where errors
 * may not be visible without pre-opened developer tools.
 * 
 * This ErrorBoundary intercepts render and lifecycle errors across the component tree,
 * displays an aesthetic, dual-theme frosted glass recovery card, logs diagnostic stack
 * traces to console.error, and provides a zero-friction reload action.
 */
export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("ErrorBoundary caught an unhandled component error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
  };

  private toggleDetails = (): void => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: "100vh",
            width: "100vw",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "var(--bg-app)",
            padding: "24px",
            boxSizing: "border-box",
            userSelect: "text",
          }}
        >
          <div
            style={{
              maxWidth: "540px",
              width: "100%",
              backgroundColor: "var(--glass-surface)",
              backdropFilter: "blur(28px)",
              WebkitBackdropFilter: "blur(28px)",
              borderRadius: "var(--radius-xl, 20px)",
              border: "1px solid var(--glass-border)",
              boxShadow: "var(--shadow-lightbox)",
              padding: "28px",
              display: "flex",
              flexDirection: "column",
              gap: "20px",
            }}
          >
            {/* Header Icon + Title */}
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div
                style={{
                  width: "44px",
                  height: "44px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(239, 68, 68, 0.12)",
                  border: "1px solid rgba(239, 68, 68, 0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent-danger)",
                  flexShrink: 0,
                }}
              >
                <AlertTriangle size={22} />
              </div>
              <div>
                <h2
                  style={{
                    fontSize: "18px",
                    fontWeight: 800,
                    letterSpacing: "-0.02em",
                    color: "var(--text-primary)",
                    margin: 0,
                    fontFamily: "var(--font-display)",
                  }}
                >
                  {this.props.fallbackTitle || "Something went wrong in this view"}
                </h2>
                <p
                  style={{
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    margin: "4px 0 0 0",
                    lineHeight: 1.4,
                  }}
                >
                  SecurePhotos encountered an unexpected interface error. Your photo files and vault remain safe on disk.
                </p>
              </div>
            </div>

            {/* Diagnostic Details Accordion */}
            {this.state.error && (
              <div
                style={{
                  borderRadius: "var(--radius-md)",
                  backgroundColor: "rgba(0, 0, 0, 0.25)",
                  border: "1px solid var(--border-subtle)",
                  overflow: "hidden",
                }}
              >
                <button
                  onClick={this.toggleDetails}
                  className="clickable"
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    backgroundColor: "transparent",
                    border: "none",
                    color: "var(--text-muted)",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span>Technical Diagnostics</span>
                  {this.state.showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {this.state.showDetails && (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderTop: "1px solid var(--border-subtle)",
                      fontSize: "11px",
                      fontFamily: "var(--font-mono)",
                      color: "var(--accent-danger)",
                      maxHeight: "180px",
                      overflowY: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    <p style={{ margin: "0 0 6px 0", fontWeight: 700 }}>
                      {this.state.error.name}: {this.state.error.message}
                    </p>
                    {this.state.errorInfo?.componentStack && (
                      <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "10px" }}>
                        {this.state.errorInfo.componentStack}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: "10px",
              }}
            >
              <button
                onClick={this.handleReset}
                className="clickable"
                style={{
                  padding: "8px 18px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-pill-border)",
                  color: "var(--text-secondary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Try Again
              </button>

              <button
                onClick={this.handleReload}
                className="clickable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 20px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--accent-primary)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: "0 2px 10px rgba(59, 130, 246, 0.35)",
                }}
              >
                <RefreshCw size={13} />
                Reload Application
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
