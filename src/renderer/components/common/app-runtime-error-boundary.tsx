import type { RendererRuntimeFailureReport } from "@shared/contracts/renderer-runtime-failure.ts";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useLayoutEffect,
} from "react";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import {
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing-slice.ts";
import { StartupErrorScreen } from "./startup-error-screen.tsx";

const RUNTIME_ERROR_OVERLAY_ID = "app-runtime-error";
const RUNTIME_ERROR_SCOPE_ID = `overlay:${RUNTIME_ERROR_OVERLAY_ID}`;

interface AppRuntimeErrorBoundaryProps {
  children: ReactNode;
  onRetry?: () => void;
}

interface AppRuntimeErrorBoundaryState {
  error: unknown;
  hasError: boolean;
}

function errorReport(
  error: unknown,
  info: ErrorInfo
): RendererRuntimeFailureReport {
  if (error instanceof Error) {
    return {
      message: error.message || "Unknown renderer error",
      name: error.name || "Error",
      ...(error.stack ? { stack: error.stack } : {}),
      ...(info.componentStack ? { componentStack: info.componentStack } : {}),
    };
  }
  return {
    message: String(error),
    name: "NonErrorThrow",
    ...(info.componentStack ? { componentStack: info.componentStack } : {}),
  };
}

function RuntimeErrorScreen({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  useLayoutEffect(() => {
    // paint 前接管：App 卸载后原生 NSView 仍在。useEffect 会留一帧
    // “看得到错误页、终端区域点不进 web”的窗口。
    const overlay = registerTerminalFullscreenWebOverlay(
      RUNTIME_ERROR_OVERLAY_ID
    );
    const releaseFocus = requestTerminalWebFocus(RUNTIME_ERROR_OVERLAY_ID);
    useKeybindingScope.getState().pushBlockingScope(RUNTIME_ERROR_SCOPE_ID);
    console.info("[renderer-runtime-fatal] recovery input claimed", {
      overlayId: RUNTIME_ERROR_OVERLAY_ID,
      scopeId: RUNTIME_ERROR_SCOPE_ID,
    });
    return () => {
      useKeybindingScope.getState().popBlockingScope(RUNTIME_ERROR_SCOPE_ID);
      releaseFocus();
      overlay.dispose();
    };
  }, []);

  return (
    <StartupErrorScreen
      error={error}
      kind="runtime"
      {...(onRetry ? { onRetry } : {})}
    />
  );
}

/**
 * 覆盖“renderer 进程仍存活，但 React 运行期错误卸载整棵树”的故障域。
 * 启动阶段仍由 main.tsx 的 StartupErrorScreen 负责，两者不互相吞错。
 */
export class AppRuntimeErrorBoundary extends Component<
  AppRuntimeErrorBoundaryProps,
  AppRuntimeErrorBoundaryState
> {
  override state: AppRuntimeErrorBoundaryState = {
    error: null,
    hasError: false,
  };

  static getDerivedStateFromError(
    error: unknown
  ): AppRuntimeErrorBoundaryState {
    return { error, hasError: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const report = errorReport(error, info);
    console.error("[renderer-runtime-fatal]", report);
    window.pier?.window?.reportRuntimeFailure?.(report);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <RuntimeErrorScreen
          error={this.state.error}
          {...(this.props.onRetry ? { onRetry: this.props.onRetry } : {})}
        />
      );
    }
    return this.props.children;
  }
}
