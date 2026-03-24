import { Component, ReactNode } from "react";

interface Props {
  pluginId: string;
  pluginName: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class PluginErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: "12px",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: "8px",
            background: "rgba(239, 68, 68, 0.05)",
            fontSize: "13px",
          }}
        >
          <div style={{ color: "#ef4444", marginBottom: "8px" }}>
            {this.props.pluginName} encountered an error
          </div>
          <div style={{ color: "#888", fontSize: "12px", marginBottom: "8px" }}>
            {this.state.error?.message}
          </div>
          <button
            onClick={this.handleRetry}
            style={{
              padding: "4px 12px",
              fontSize: "12px",
              borderRadius: "4px",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.05)",
              color: "#e2e8f0",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
