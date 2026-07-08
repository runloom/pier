import type { IDockviewPanelProps } from "dockview-react";
import { Activity, type FunctionComponent, type ReactNode } from "react";
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
