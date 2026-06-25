import type { IDockviewHeaderActionsProps } from "dockview-react";
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
