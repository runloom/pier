import type { IDockviewHeaderActionsProps } from "dockview-react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { Button } from "../primitives/button.tsx";
import { AddPanelAction } from "./add-panel-action.tsx";
import { PanelOverflowMenu } from "./panel-overflow.tsx";

export function WorkspaceHeaderActions(props: IDockviewHeaderActionsProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <PanelOverflowMenu {...props} />
      <AddPanelAction {...props} />
    </div>
  );
}

export function WorkspaceHeaderRightActions(
  props: IDockviewHeaderActionsProps
) {
  useWorkspaceStore((s) => s.hasMaximizedGroup);
  const panel = props.activePanel;
  if (!panel) {
    return <div className="flex h-full items-center justify-center px-1" />;
  }

  const isMaximized = panel.api.isMaximized();
  const Icon = isMaximized ? Minimize2 : Maximize2;
  const label = isMaximized ? "Minimize panel" : "Maximize panel";

  const handleToggle = () => {
    panel.api.setActive();
    if (panel.api.isMaximized()) {
      panel.api.exitMaximized();
      return;
    }
    panel.api.maximize();
  };

  return (
    <div className="flex h-full items-center justify-center px-1">
      <Button
        aria-label={label}
        aria-pressed={isMaximized}
        onClick={handleToggle}
        size="icon-xs"
        title={label}
        type="button"
        variant="secondary"
      >
        <Icon />
      </Button>
    </div>
  );
}
