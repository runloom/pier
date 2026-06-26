import i18next from "i18next";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

export function registerViewActions(): () => void {
  const disposers = [
    actionRegistry.register({
      id: "pier.view.zoomIn",
      category: "View",
      title: () => i18next.t("commandPalette.action.zoomIn"),
      surfaces: ["command-palette"],
      metadata: {
        group: "4_view",
        iconComponent: ZoomIn,
        sortOrder: 40,
        keywords: ["zoom", "zoom in", "放大", "界面"],
      },
      handler: () => useZoomStore.getState().zoomIn(),
    }),
    actionRegistry.register({
      id: "pier.view.zoomOut",
      category: "View",
      title: () => i18next.t("commandPalette.action.zoomOut"),
      surfaces: ["command-palette"],
      metadata: {
        group: "4_view",
        iconComponent: ZoomOut,
        sortOrder: 41,
        keywords: ["zoom", "zoom out", "缩小", "界面"],
      },
      handler: () => useZoomStore.getState().zoomOut(),
    }),
    actionRegistry.register({
      id: "pier.view.resetZoom",
      category: "View",
      title: () => i18next.t("commandPalette.action.resetZoom"),
      surfaces: ["command-palette"],
      metadata: {
        group: "4_view",
        iconComponent: RotateCcw,
        sortOrder: 42,
        keywords: ["zoom", "reset zoom", "重置", "界面缩放"],
      },
      handler: () => useZoomStore.getState().resetZoom(),
    }),
  ];

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
