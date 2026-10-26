import type { DockviewApi } from "dockview-react";
import { releaseTabFocusOutsideGroup } from "@/lib/workspace/focused-tab.ts";
import { activatePanelFromContentPointerDown } from "@/lib/workspace/pointer-activation.ts";
import {
  isTabRevealSuppressed,
  suppressTabRevealForCurrentInteraction,
} from "@/lib/workspace/tab-reveal-suppress.ts";
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

  // Content-area pointerdown focuses the container (tabIndex=-1) → dockview
  // activates the group in the same turn. That user gesture must not scroll
  // the strip; only tab clicks / keyboard nav / explicit reveals may.
  //
  // The same capture also activates the group explicitly: controls that
  // preventDefault() on pointerdown suppress the focus move, and without this
  // the previous group stays "active" (Cmd+W would close its tab).
  const onContentPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(".dv-content-container") !== null
    ) {
      suppressTabRevealForCurrentInteraction();
    }
    if (event.button === 0) {
      activatePanelFromContentPointerDown(api, target);
    }
  };
  const listenerDocument =
    root instanceof Document ? root : (root as Element).ownerDocument;
  listenerDocument?.addEventListener("pointerdown", onContentPointerDown, {
    capture: true,
  });

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

  // Programmatic group switches (focus-right, setActive, native terminal
  // focus intent) do not move DOM focus. Drop tab-strip focus left in the old
  // group so Cmd+W resolves the newly active panel, not the stale tab.
  const activePanelSubscription = asDisposable(
    typeof api.onDidActivePanelChange === "function"
      ? api.onDidActivePanelChange((change) => {
          releaseTabFocusOutsideGroup(change.panel?.group?.element);
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
    listenerDocument?.removeEventListener("pointerdown", onContentPointerDown, {
      capture: true,
    });
    maximizedSubscription.dispose();
    activeGroupSubscription.dispose();
    activePanelSubscription.dispose();
    layoutSubscription.dispose();
    setTabStripRevealAbortHook(null);
    setActiveTabStripScrollMemory(null);
    scrollMemory.dispose();
  };
}
