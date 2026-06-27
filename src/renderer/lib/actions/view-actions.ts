import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { rendererActionContributionRuntime } from "@/lib/actions/renderer-action-runtime.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

export const VIEW_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  {
    aliasesKey: "commandPalette.aliases.zoomIn",
    categoryKey: "view",
    group: "4_view",
    handler: () => useZoomStore.getState().zoomIn(),
    iconComponent: ZoomIn,
    id: "pier.view.zoomIn",
    sortOrder: 40,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.zoomIn",
  },
  {
    aliasesKey: "commandPalette.aliases.zoomOut",
    categoryKey: "view",
    group: "4_view",
    handler: () => useZoomStore.getState().zoomOut(),
    iconComponent: ZoomOut,
    id: "pier.view.zoomOut",
    sortOrder: 41,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.zoomOut",
  },
  {
    aliasesKey: "commandPalette.aliases.resetZoom",
    categoryKey: "view",
    group: "4_view",
    handler: () => useZoomStore.getState().resetZoom(),
    iconComponent: RotateCcw,
    id: "pier.view.resetZoom",
    sortOrder: 42,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.resetZoom",
  },
];

export function registerViewActions(): () => void {
  const disposers = registerActionContributions(
    VIEW_ACTION_CONTRIBUTIONS,
    rendererActionContributionRuntime
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
