import type {
  TerminalDebugRendererSnapshot,
  TerminalDebugSnapshot,
} from "@shared/contracts/terminal.ts";
import { buildTerminalDebugIssues } from "@shared/terminal-debug-diagnostics.ts";
import { create } from "zustand";
import {
  hasRegisteredTerminalAnchor,
  readRegisteredTerminalAnchorFrame,
} from "@/panel-kits/terminal/terminal-layout-coordinator.ts";
import { readTerminalPanelLifecycleDebug } from "@/panel-kits/terminal/terminal-lifecycle-debug.ts";
import { getLastTerminalPresentationSnapshot } from "@/panel-kits/terminal/terminal-presentation-reconciler.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

interface TerminalDebugState {
  close(): void;
  error: string | null;
  isOpen: boolean;
  refresh(): Promise<void>;
  snapshot: TerminalDebugSnapshot | null;
  toggle(): void;
}

export function buildRendererDebugSnapshot(): TerminalDebugRendererSnapshot {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    return {
      activePanelId: null,
      hasMaximizedGroup: false,
      panelCount: 0,
      panels: [],
    };
  }
  const activePanelId = api.activePanel?.id ?? null;
  return {
    activePanelId,
    desiredPresentation: getLastTerminalPresentationSnapshot() ?? undefined,
    hasMaximizedGroup: api.hasMaximizedGroup(),
    panelCount: api.panels.length,
    viewportFrame: {
      height: window.innerHeight,
      width: window.innerWidth,
      x: 0,
      y: 0,
    },
    panels: api.panels.map((panel) => ({
      anchorFrame: readRegisteredTerminalAnchorFrame(panel.id),
      component: panel.view.contentComponent,
      dockviewActive: panel.api.isActive,
      dockviewVisible: panel.api.isVisible,
      hasAnchor: hasRegisteredTerminalAnchor(panel.id),
      isActivePanel: panel.id === activePanelId,
      panelId: panel.id,
      terminalLifecycle: readTerminalPanelLifecycleDebug(panel.id),
    })),
  };
}

export const useTerminalDebugStore = create<TerminalDebugState>((set) => ({
  close: () => set({ isOpen: false }),
  error: null,
  isOpen: false,
  refresh: async () => {
    try {
      const snapshot = await window.pier.terminal.debugSnapshot();
      const renderer = buildRendererDebugSnapshot();
      set({
        error: null,
        snapshot: {
          ...snapshot,
          issues: buildTerminalDebugIssues(
            renderer,
            snapshot.native,
            snapshot.presentation
          ),
          renderer,
        },
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
  snapshot: null,
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
}));
