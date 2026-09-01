// Note: the `transfer?` field on PluginPanelRegistration is plumbed through
// the type (see @plugins/api/renderer-panels.ts) and consumed by the workspace
// panel-transfer resolver (panel-transfer-adapters.ts). This boundary only
// renders the panel component and its descriptor; it does not need to read
// `transfer?` — the resolver reads it from the registration map directly.

import { ErrorEmpty } from "@pier/ui/error-empty.tsx";
import type { PluginPanelRegistration } from "@plugins/api/renderer.ts";
import type { IDockviewPanelProps } from "dockview-react";
import {
  Activity,
  Component,
  type ErrorInfo,
  type FunctionComponent,
  type ReactNode,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";
import { useT } from "@/i18n/use-t.ts";
import {
  panelContextFromPluginParams,
  pluginPanelDescriptor,
  resolveRegistrationTitle,
} from "@/lib/plugins/host/panel-descriptors.ts";
import { PanelContentContextShell } from "./panel-content-context-shell.tsx";

interface PanelResourceBoundaryProps {
  api: IDockviewPanelProps["api"];
  children: ReactNode;
}

export function PanelResourceBoundary({
  api,
  children,
}: PanelResourceBoundaryProps) {
  const visible = useDockviewPanelVisible(api);
  return <Activity mode={visible ? "visible" : "hidden"}>{children}</Activity>;
}

export function withPanelResourceBoundary(
  Component: FunctionComponent<IDockviewPanelProps>
): FunctionComponent<IDockviewPanelProps> {
  function ResourceBoundPanel(props: IDockviewPanelProps) {
    return (
      <PanelResourceBoundary api={props.api}>
        <PanelContentContextShell
          api={props.api}
          component={props.api.component}
          params={props.params}
        >
          <Component {...props} />
        </PanelContentContextShell>
      </PanelResourceBoundary>
    );
  }

  ResourceBoundPanel.displayName = `ResourceBoundPanel(${
    Component.displayName || Component.name || "Panel"
  })`;
  return ResourceBoundPanel;
}

function useDockviewPanelVisible(api: IDockviewPanelProps["api"]): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const visible = api.onDidVisibilityChange(listener);
      return () => visible.dispose();
    },
    [api]
  );
  const getSnapshot = useCallback(() => api.isVisible, [api]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * 不使用 Activity。子组件始终挂载于 panel 存活期，自行按 isVisible
 * 卸载重资源；这样才能在 panel 真正关闭时仍收到 shell cleanup 并回收 session。
 */
function UnmountWhenHiddenPanel({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return children;
}

/**
 * 插件面板局部错误边界（失败语义契约：面板渲染抛错 → 仅该面板显示错误态，
 * 其余面板与工作区不受影响）。见 docs/superpowers/specs/
 * 2026-08-24-plugin-failure-semantics.md 的失败矩阵。
 */
export class PluginPanelErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // 失败矩阵 F1：渲染错误已在 getDerivedStateFromError 转为局部错误态。
    // 这里刻意不向 App 级诊断上报——单面板崩溃不应触发全局恢复页。
  }

  override render(): ReactNode {
    if (this.state.error) {
      return <PluginPanelCrashState message={this.state.error.message} />;
    }
    return this.props.children;
  }
}

function PluginPanelCrashState({ message }: { message: string }): ReactNode {
  const t = useT();
  return (
    <ErrorEmpty
      description={t("workspace.pluginPanel.crashDescription") || message}
      title={t("workspace.pluginPanel.crashTitle")}
    />
  );
}

export function withPluginPanelHostBoundary(
  registration: PluginPanelRegistration
): FunctionComponent<IDockviewPanelProps> {
  const Component = registration.component;

  function PluginPanelHost(props: IDockviewPanelProps) {
    const params = (props.params ?? {}) as Readonly<Record<string, unknown>>;
    const title =
      props.api.title ?? resolveRegistrationTitle(registration, props.api.id);
    const descriptor = useMemo(
      () =>
        pluginPanelDescriptor(
          props.api.id,
          registration,
          panelContextFromPluginParams(params),
          title,
          params
        ),
      [params, props.api.id, title]
    );
    usePanelDescriptor(props.api, descriptor);

    // 失败矩阵：插件组件渲染抛错必须被局部边界截住（含 terminal kind ——
    // 外部插件本就不允许注册 terminal，但宿主仍按同一契约防御）。
    const bounded = (
      <PluginPanelErrorBoundary>
        <Component {...props} />
      </PluginPanelErrorBoundary>
    );

    if (registration.kind === "terminal") {
      return bounded;
    }
    if (registration.resourcePolicy === "unmountWhenHidden") {
      return (
        <UnmountWhenHiddenPanel>
          <PanelContentContextShell
            api={props.api}
            component={registration.id}
            params={props.params}
          >
            {bounded}
          </PanelContentContextShell>
        </UnmountWhenHiddenPanel>
      );
    }
    return (
      <PanelResourceBoundary api={props.api}>
        <PanelContentContextShell
          api={props.api}
          component={registration.id}
          params={props.params}
        >
          {bounded}
        </PanelContentContextShell>
      </PanelResourceBoundary>
    );
  }

  PluginPanelHost.displayName = `PluginPanelHost(${
    Component.displayName || Component.name || registration.id
  })`;
  return PluginPanelHost;
}
