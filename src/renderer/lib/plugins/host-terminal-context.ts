import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { useWorkspaceStore } from "../../stores/workspace.store.ts";

type AssertPluginCapability = (
  entry: PluginRegistryEntry | undefined,
  capability: PierCapability
) => void;

function activeTerminalPanelId(): string | null {
  const activePanel = useWorkspaceStore.getState().api?.activePanel;
  return activePanel?.view.contentComponent === "terminal"
    ? activePanel.id
    : null;
}

export function createPluginTerminalContext(
  entry: PluginRegistryEntry | undefined,
  assertPluginCapability: AssertPluginCapability
): RendererPluginContext["terminal"] {
  return {
    activePanelId: activeTerminalPanelId,
    readSelectionText: (panelId) =>
      Promise.resolve().then(() => {
        assertPluginCapability(entry, "terminal:read");
        const targetPanelId = panelId ?? activeTerminalPanelId();
        if (!targetPanelId) {
          return { kind: "empty" };
        }
        return window.pier.terminal.readSelectionText(targetPanelId);
      }),
  };
}
