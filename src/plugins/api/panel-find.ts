/**
 * Host find commands (`pier.find` / `pier.findNext` / `pier.findPrev`) →
 * files / git review panels. Window event so builtin plugins stay off
 * renderer action internals.
 */
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";

export const PANEL_FIND_EVENT = "pier:panel:find";

export type PanelFindAction = "next" | "open" | "prev";

export interface PanelFindEventDetail {
  readonly action: PanelFindAction;
  readonly panelId: string;
}

const PANEL_FIND_ACTIONS = new Set<PanelFindAction>(["next", "open", "prev"]);

export function dispatchPanelFind(
  panelId: string,
  action: PanelFindAction = "open"
): void {
  window.dispatchEvent(
    new CustomEvent<PanelFindEventDetail>(PANEL_FIND_EVENT, {
      detail: { action, panelId },
    })
  );
}

export function isPanelFindEvent(
  event: Event
): event is CustomEvent<PanelFindEventDetail> {
  return (
    event.type === PANEL_FIND_EVENT &&
    event instanceof CustomEvent &&
    typeof event.detail?.panelId === "string" &&
    PANEL_FIND_ACTIONS.has(event.detail.action)
  );
}

export function usePanelFind(
  panelId: string | null | undefined,
  onFind: (action: PanelFindAction) => void
): void {
  useEffect(() => {
    if (!panelId) {
      return;
    }
    const onEvent = (event: Event): void => {
      if (!isPanelFindEvent(event) || event.detail.panelId !== panelId) {
        return;
      }
      onFind(event.detail.action);
    };
    window.addEventListener(PANEL_FIND_EVENT, onEvent);
    return () => {
      window.removeEventListener(PANEL_FIND_EVENT, onEvent);
    };
  }, [onFind, panelId]);
}

/** Files editor / preview search: bump the same counter chrome 🔍 uses. */
export function usePanelFindSearchRequest(
  panelId: string | null | undefined
): readonly [number, Dispatch<SetStateAction<number>>] {
  const [searchRequest, setSearchRequest] = useState(0);
  const bump = useCallback((action: PanelFindAction) => {
    if (action === "open") {
      setSearchRequest((value) => value + 1);
    }
  }, []);
  usePanelFind(panelId, bump);
  return [searchRequest, setSearchRequest];
}
