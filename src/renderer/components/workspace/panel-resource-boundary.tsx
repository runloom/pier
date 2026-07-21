// Note: the `transfer?` field on PluginPanelRegistration is plumbed through
// the type (see @plugins/api/renderer-panels.ts) and consumed by the workspace
// panel-transfer resolver (panel-transfer-adapters.ts). This boundary only
// renders the panel component and its descriptor; it does not need to read
// `transfer?` — the resolver reads it from the registration map directly.
import type { PluginPanelRegistration } from "@plugins/api/renderer.ts";
import type { IDockviewPanelProps } from "dockview-react";
import {
  Activity,
  type FunctionComponent,
  type ReactNode,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";
import {
  panelContextFromPluginParams,
  pluginPanelDescriptor,
  resolveRegistrationTitle,
} from "@/lib/plugins/host-panel-descriptors.ts";
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

    if (registration.kind === "terminal") {
      return <Component {...props} />;
    }
    if (registration.resourcePolicy === "unmountWhenHidden") {
      return (
        <UnmountWhenHiddenPanel>
          <PanelContentContextShell api={props.api} component={registration.id}>
            <Component {...props} />
          </PanelContentContextShell>
        </UnmountWhenHiddenPanel>
      );
    }
    return (
      <PanelResourceBoundary api={props.api}>
        <PanelContentContextShell api={props.api} component={registration.id}>
          <Component {...props} />
        </PanelContentContextShell>
      </PanelResourceBoundary>
    );
  }

  PluginPanelHost.displayName = `PluginPanelHost(${
    Component.displayName || Component.name || registration.id
  })`;
  return PluginPanelHost;
}
