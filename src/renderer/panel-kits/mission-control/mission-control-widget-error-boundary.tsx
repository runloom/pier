import { WidgetError } from "@pier/ui/widget-state.tsx";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface WidgetErrorBoundaryProps {
  children: ReactNode;
  fallbackMessage: string;
  onRetry: () => void;
  resetKey: number;
  retryLabel: string;
  widgetId: string;
}

interface WidgetErrorBoundaryState {
  error: Error | null;
}

/**
 * per-card 错误边界：物料崩溃不炸整个指挥中心。refreshToken 变化只清除
 * 错误态，不重挂载正常物料，确保刷新 effect 能观察到令牌变化。
 */
export class WidgetErrorBoundary extends Component<
  WidgetErrorBoundaryProps,
  WidgetErrorBoundaryState
> {
  constructor(props: WidgetErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): WidgetErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 用户可见反馈由 WidgetError 承载；此处仅补诊断日志。
    console.error(
      `[mission-control] widget ${this.props.widgetId} crashed:`,
      error,
      info.componentStack
    );
  }

  override componentDidUpdate(previousProps: WidgetErrorBoundaryProps): void {
    if (
      previousProps.resetKey !== this.props.resetKey &&
      this.state.error !== null
    ) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <WidgetError
          message={this.state.error.message || this.props.fallbackMessage}
          onRetry={this.props.onRetry}
          retryLabel={this.props.retryLabel}
        />
      );
    }
    return this.props.children;
  }
}
