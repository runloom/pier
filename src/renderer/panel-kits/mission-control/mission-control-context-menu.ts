import type { MenuTemplate } from "@shared/contracts/menu.ts";
import i18next from "i18next";
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import { popupMenuTemplateAt } from "@/lib/context-menu/use-context-menu.ts";
import { cssPointToContentViewPoint } from "@/lib/window-zoom/coordinates.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

const MENU_ACTION = {
  addWidget: "pier.missionControl.addWidget",
  refreshAll: "pier.missionControl.refreshAll",
} as const;

interface MissionControlContextMenuState {
  hasWidgets: boolean;
  onAddWidget: () => void;
  onRefreshAll: () => void;
}

function buildTemplate(state: MissionControlContextMenuState): MenuTemplate {
  return [
    {
      id: MENU_ACTION.addWidget,
      label: i18next.t("missionControl.addWidget"),
      type: "action",
    },
    {
      enabled: state.hasWidgets,
      id: MENU_ACTION.refreshAll,
      label: i18next.t("missionControl.context.refreshAll"),
      type: "action",
    },
  ];
}

function dispatchAction(
  state: MissionControlContextMenuState,
  actionId: string
): void {
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
}

export function useMissionControlContextMenu(
  state: MissionControlContextMenuState
): {
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
} {
  const latestRef = useRef(state);
  useLayoutEffect(() => {
    latestRef.current = state;
  }, [state]);

  const openAt = useCallback((point: { x: number; y: number }) => {
    const snapshot = latestRef.current;
    const coords = cssPointToContentViewPoint(
      point,
      useZoomStore.getState().windowZoomLevel
    );
    popupMenuTemplateAt(buildTemplate(snapshot), coords, (actionId) => {
      dispatchAction(latestRef.current, actionId);
    }).catch((error: unknown) => {
      showAppAlert({
        body: error instanceof Error ? error.message : String(error),
        title: i18next.t("missionControl.context.menuFailed"),
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
