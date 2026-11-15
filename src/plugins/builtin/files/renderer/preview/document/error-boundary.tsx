import { Component, type ReactNode } from "react";

interface DocumentPreviewErrorBoundaryProps {
  children: ReactNode;
  fallback: (error: unknown, reset: () => void) => ReactNode;
}

interface DocumentPreviewErrorBoundaryState {
  error: unknown;
  failed: boolean;
}

// biome-ignore lint/style/useReactFunctionComponents: React error boundaries require a class lifecycle.
export class DocumentPreviewErrorBoundary extends Component<
  DocumentPreviewErrorBoundaryProps,
  DocumentPreviewErrorBoundaryState
> {
  override state: DocumentPreviewErrorBoundaryState = {
    error: null,
    failed: false,
  };

  static getDerivedStateFromError(
    error: unknown
  ): DocumentPreviewErrorBoundaryState {
    return { error, failed: true };
  }

  reset = (): void => {
    this.setState({ error: null, failed: false });
  };

  override render(): ReactNode {
    if (this.state.failed) {
      return this.props.fallback(this.state.error, this.reset);
    }
    return this.props.children;
  }
}
