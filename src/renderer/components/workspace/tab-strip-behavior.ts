import type { DockviewApi } from "dockview-react";
import { isTabRevealSuppressed } from "@/lib/workspace/tab-reveal-suppress.ts";
import {
  createTabStripScrollMemory,
  setActiveTabStripScrollMemory,
  setTabStripRevealAbortHook,
} from "@/lib/workspace/tab-strip-scroll.ts";
import {
  abortScheduledDockviewTabReveal,
  scheduleRevealDockviewTabByPanelId,
} from "@/lib/workspace/tab-visibility.ts";

/**
 * Workspace tab-strip behavior that dockview does not own:
 * - remember / restore horizontal scroll across maximize hide (size→0)
 * - reveal the active tab when the focused group changes (window focus)
 *
 * Terminal surface clicks suppress reveal via `withSuppressedTabReveal`.
 * Maximize entry snapshot is prepared from workspace actions (P1) before
 * dockview mutates visibility; this module freezes on the event as fallback.
 * K2: skip reveal while layout-restore is in flight.
 */
export function attachWorkspaceTabStripBehavior(
  api: DockviewApi,
  root: ParentNode | null
): () => void {
  if (!root) {
    return () => undefined;
  }

  const scrollMemory = createTabStripScrollMemory({
    // Tests and early dockview ready may omit groups; never throw in attach.
    getGroups: () => api.groups ?? [],
    root,
  });
  setActiveTabStripScrollMemory(scrollMemory);
  setTabStripRevealAbortHook(abortScheduledDockviewTabReveal);

  const revealActiveGroupTab = (
    group: DockviewApi["activeGroup"] | undefined
  ): void => {
    if (isTabRevealSuppressed()) {
      return;
    }
    // layout-restore beats reveal-active in the same turn (K2 / §4.3).
    if (scrollMemory.isLayoutRestoreInFlight()) {
      return;
    }
    const panelId = group?.activePanel?.id;
    if (!panelId) {
      return;
    }
    scheduleRevealDockviewTabByPanelId(panelId, root);
  };

  const noopDispose = { dispose: () => undefined };
  const asDisposable = (
    value: { dispose: () => void } | null | undefined
  ): { dispose: () => void } => value ?? noopDispose;

  const maximizedSubscription = asDisposable(
    typeof api.onDidMaximizedGroupChange === "function"
      ? api.onDidMaximizedGroupChange((event) => {
          if (event.isMaximized) {
            // Fallback freeze if action path skipped prepareForMaximizeLayoutMutation.
            scrollMemory.freeze();
            return;
          }
          scrollMemory.scheduleRestoreAndUnfreeze();
        })
      : undefined
  );

  const activeGroupSubscription = asDisposable(
    typeof api.onDidActiveGroupChange === "function"
      ? api.onDidActiveGroupChange((group) => {
          scrollMemory.rememberVisible();
          revealActiveGroupTab(group);
        })
      : undefined
  );

  // New groups / splits: bind scroll listeners; prune memory for removed groups.
  const layoutSubscription = asDisposable(
    typeof api.onDidLayoutChange === "function"
      ? api.onDidLayoutChange(() => {
          scrollMemory.rememberVisible();
        })
      : undefined
  );

  return () => {
    maximizedSubscription.dispose();
    activeGroupSubscription.dispose();
    layoutSubscription.dispose();
    setTabStripRevealAbortHook(null);
    setActiveTabStripScrollMemory(null);
    scrollMemory.dispose();
  };
}
