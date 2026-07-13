import type { PluginPanelRegistration } from "@plugins/api/renderer.ts";
import type { IDockviewPanelProps } from "dockview-react";
import {
  Activity,
  type FunctionComponent,
  type ReactNode,
  useMemo,
} from "react";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";
import {
  panelContextFromPluginParams,
  pluginPanelDescriptor,
  resolveRegistrationTitle,
} from "@/lib/plugins/host-panel-descriptors.ts";
import { usePanelResourceMode } from "@/stores/panel-resource.store.ts";

interface PanelResourceBoundaryProps {
  children: ReactNode;
  panelId: string;
}

export function PanelResourceBoundary({
  children,
  panelId,
}: PanelResourceBoundaryProps) {
  const mode = usePanelResourceMode(panelId);
  return (
    <Activity mode={mode === "visible" ? "visible" : "hidden"}>
      {children}
    </Activity>
  );
}

export function withPanelResourceBoundary(
  Component: FunctionComponent<IDockviewPanelProps>
): FunctionComponent<IDockviewPanelProps> {
  function ResourceBoundPanel(props: IDockviewPanelProps) {
    return (
      <PanelResourceBoundary panelId={props.api.id}>
        <Component {...props} />
      </PanelResourceBoundary>
    );
  }

  ResourceBoundPanel.displayName = `ResourceBoundPanel(${
    Component.displayName || Component.name || "Panel"
  })`;
  return ResourceBoundPanel;
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
    return (
      <PanelResourceBoundary panelId={props.api.id}>
        <Component {...props} />
      </PanelResourceBoundary>
    );
  }

  PluginPanelHost.displayName = `PluginPanelHost(${
    Component.displayName || Component.name || registration.id
  })`;
  return PluginPanelHost;
}
