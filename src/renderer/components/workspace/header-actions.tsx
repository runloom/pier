import { Button } from "@pier/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import type { IDockviewHeaderActionsProps } from "dockview-react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  actionRegistry,
  getActionRegistryVersion,
  subscribeActionRegistry,
} from "@/lib/actions/registry.ts";
import type { Action } from "@/lib/actions/types.ts";
import { useActionKeybindingLabel } from "@/lib/keybindings/use-action-label.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
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

function useRegisteredAction(id: string): Action | undefined {
  useSyncExternalStore(
    subscribeActionRegistry,
    getActionRegistryVersion,
    () => 0
  );
  return actionRegistry.get(id);
}

function runHeaderAction(
  action: Action | undefined,
  panel: IDockviewHeaderActionsProps["activePanel"]
): void {
  if (!(action && panel)) {
    return;
  }
  panel.api.setActive();
  if (action.enabled?.() === false) {
    return;
  }
  Promise.resolve(action.handler()).catch((err) => {
    console.error(`[workspace-header] action ${action.id} failed:`, err);
  });
}

export function WorkspaceHeaderRightActions(
  props: IDockviewHeaderActionsProps
) {
  const t = useT();
  useWorkspaceStore((s) => s.hasMaximizedGroup);
  const toggleAction = useRegisteredAction("pier.panel.toggleMaximized");
  const shortcut = useActionKeybindingLabel("pier.panel.toggleMaximized");
  const panel = props.activePanel;
  if (!panel) {
    return <div className="flex h-full items-center justify-center px-1" />;
  }

  const isMaximized = panel.api.isMaximized();
  // Maximize only matters with 2+ split groups (same gate as equalize). Keep
  // the control while maximized so restore remains reachable from the header.
  const groupCount = props.containerApi.groups.length;
  const canToggleMaximize = groupCount > 1 || isMaximized;
  const Icon = isMaximized ? Minimize2 : Maximize2;
  const variant = isMaximized ? "default" : "secondary";
  const toggleLabel = isMaximized
    ? t("workspace.tab.restore")
    : t("workspace.tab.maximize");

  return (
    <div className="flex h-full items-center justify-center gap-1 px-1">
      {toggleAction && canToggleMaximize ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={toggleLabel}
              aria-pressed={isMaximized}
              disabled={toggleAction.enabled?.() === false}
              onClick={() => runHeaderAction(toggleAction, panel)}
              size="icon-xs"
              type="button"
              variant={variant}
            >
              <Icon data-icon="inline-start" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {toggleLabel}
            {shortcut ? (
              <span className="text-background/70 tracking-wide">
                {shortcut}
              </span>
            ) : null}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
