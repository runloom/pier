import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { buildWorkspacePanelSnapshots } from "@/components/workspace/workspace-panel-snapshots.ts";
import { usePanelDescriptorStore } from "../../stores/panel-descriptor.store.ts";
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

function terminalPanelContext(panelId: string): PanelContext | null {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    return null;
  }
  const match = buildWorkspacePanelSnapshots(
    api,
    usePanelDescriptorStore.getState().descriptors
  ).find((entry) => entry.id === panelId && entry.kind === "terminal");
  return match?.context ?? null;
}

export function createPluginTerminalContext(
  entry: PluginRegistryEntry | undefined,
  assertPluginCapability: AssertPluginCapability
): RendererPluginContext["terminal"] {
  return {
    activePanelId: activeTerminalPanelId,
    getPanelContext: (panelId) => {
      assertPluginCapability(entry, "terminal:read");
      return terminalPanelContext(panelId);
    },
    onOpenUrl: (cb) => {
      assertPluginCapability(entry, "terminal:read");
      return window.pier.terminal.onOpenUrl(cb);
    },
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
