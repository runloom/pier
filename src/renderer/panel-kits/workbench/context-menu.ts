import type { MenuTemplate } from "@shared/contracts/menu.ts";
import i18next from "i18next";
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import { actionRegistry } from "@/lib/actions/registry.ts";
import type { ActionInvocation } from "@/lib/actions/types.ts";
import {
  buildMenuEntries,
  PANEL_EDIT_SURFACE,
  PANEL_LAYOUT_SURFACE,
} from "@/lib/context-menu/build-entries.ts";
import { captureDomSelectionText } from "@/lib/context-menu/selection-text.ts";
import { popupMenuTemplateAt } from "@/lib/context-menu/use-menu.ts";
import { cssPointToContentViewPoint } from "@/lib/window-zoom/coordinates.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

const MENU_ACTION = {
  addWidget: "pier.workbench.addWidget",
  refreshAll: "pier.workbench.refreshAll",
} as const;

interface WorkbenchContextMenuState {
  activatePanel?: () => void;
  hasWidgets: boolean;
  onAddWidget: () => void;
  onRefreshAll: () => void;
  panelId?: string;
}

function selectionInvocation(sourcePanelId?: string): ActionInvocation {
  const selectedText = captureDomSelectionText(sourcePanelId);
  return {
    metadata: selectedText.length > 0 ? { selectedText } : {},
    ...(sourcePanelId ? { sourcePanelId } : {}),
    // 工作台画布 viewport：与 panel/content 同语义，edit + layout。
    surface: PANEL_EDIT_SURFACE,
  };
}

function buildTemplate(
  state: WorkbenchContextMenuState,
  invocation: ActionInvocation
): MenuTemplate {
  const local: MenuTemplate = [
    {
      id: MENU_ACTION.addWidget,
      label: i18next.t("workbench.addWidget"),
      type: "action",
    },
    {
      enabled: state.hasWidgets,
      id: MENU_ACTION.refreshAll,
      label: i18next.t("workbench.context.refreshAll"),
      type: "action",
    },
  ];
  // 工作台自管菜单并 stopPropagation，不经内容区 shell；显式并入 edit + layout。
  const edit = buildMenuEntries(PANEL_EDIT_SURFACE, {
    ...invocation,
    surface: PANEL_EDIT_SURFACE,
  });
  const layout = buildMenuEntries(PANEL_LAYOUT_SURFACE, {
    ...invocation,
    surface: PANEL_LAYOUT_SURFACE,
  });
  let sharedFlat: MenuTemplate;
  if (edit.length === 0) {
    sharedFlat = layout;
  } else if (layout.length === 0) {
    sharedFlat = edit;
  } else {
    sharedFlat = [...edit, { type: "separator" }, ...layout];
  }
  if (sharedFlat.length === 0) {
    return local;
  }
  return [...local, { type: "separator" }, ...sharedFlat];
}

async function dispatchAction(
  state: WorkbenchContextMenuState,
  actionId: string,
  invocation: ActionInvocation
): Promise<void> {
  if (actionId === MENU_ACTION.addWidget) {
    state.onAddWidget();
    return;
  }
  if (actionId === MENU_ACTION.refreshAll) {
    if (state.hasWidgets) {
      state.onRefreshAll();
    }
    return;
  }
  const action = actionRegistry.get(actionId);
  if (!action) {
    return;
  }
  if (action.enabled?.(invocation) === false) {
    return;
  }
  await Promise.resolve(action.handler(invocation));
}

export function useWorkbenchContextMenu(state: WorkbenchContextMenuState): {
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
} {
  const latestRef = useRef(state);
  useLayoutEffect(() => {
    latestRef.current = state;
  }, [state]);

  const openAt = useCallback((point: { x: number; y: number }) => {
    const snapshot = latestRef.current;
    const invocation = selectionInvocation(snapshot.panelId);
    const coords = cssPointToContentViewPoint(
      point,
      useZoomStore.getState().windowZoomLevel
    );
    popupMenuTemplateAt(
      buildTemplate(snapshot, invocation),
      coords,
      async (actionId) => {
        await dispatchAction(latestRef.current, actionId, invocation);
      }
    ).catch((error: unknown) => {
      showAppAlert({
        body: error instanceof Error ? error.message : String(error),
        title: i18next.t("workbench.context.menuFailed"),
      });
    });
  }, []);

  const onContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const target = event.target;
      if (
        event.defaultPrevented ||
        (target instanceof Element &&
          target.closest('[data-slot="dropdown-menu-trigger"]'))
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      latestRef.current.activatePanel?.();
      openAt({ x: event.clientX, y: event.clientY });
    },
    [openAt]
  );
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) {
        return;
      }
      const opensMenu =
        event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
      if (!opensMenu) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      latestRef.current.activatePanel?.();
      const rect = event.currentTarget.getBoundingClientRect();
      const inset = 8;
      openAt({
        x: Math.min(
          Math.max(rect.left + inset, inset),
          Math.max(inset, window.innerWidth - inset)
        ),
        y: Math.min(
          Math.max(rect.top + inset, inset),
          Math.max(inset, window.innerHeight - inset)
        ),
      });
    },
    [openAt]
  );

  return { onContextMenu, onKeyDown };
}
