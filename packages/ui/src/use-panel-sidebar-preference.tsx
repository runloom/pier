import { useCallback, useEffect, useState } from "react";

/** Same-window live sync when sidebar collapsed preference is written. */
export const PANEL_SIDEBAR_COLLAPSED_EVENT = "pier:panel-sidebar-collapsed";

export interface PanelSidebarCollapsedEventDetail {
  collapsed: boolean;
  identity: string;
  storagePrefix: string;
}

function preferenceStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function preferenceKey(storagePrefix: string, identity: string): string {
  return storagePrefix.concat(identity);
}

export function readPanelSidebarCollapsed(
  storagePrefix: string,
  identity: string | null
): boolean {
  if (!identity) {
    return false;
  }
  return (
    preferenceStorage()?.getItem(preferenceKey(storagePrefix, identity)) ===
    "true"
  );
}

export function writePanelSidebarCollapsed(
  storagePrefix: string,
  identity: string,
  collapsed: boolean
): void {
  preferenceStorage()?.setItem(
    preferenceKey(storagePrefix, identity),
    String(collapsed)
  );
  if (typeof globalThis.dispatchEvent === "function") {
    globalThis.dispatchEvent(
      new CustomEvent<PanelSidebarCollapsedEventDetail>(
        PANEL_SIDEBAR_COLLAPSED_EVENT,
        {
          detail: { collapsed, identity, storagePrefix },
        }
      )
    );
  }
}

/** Flip collapsed preference; returns the new value, or null when identity missing. */
export function togglePanelSidebarCollapsed(
  storagePrefix: string,
  identity: string | null
): boolean | null {
  if (!identity) {
    return null;
  }
  const next = !readPanelSidebarCollapsed(storagePrefix, identity);
  writePanelSidebarCollapsed(storagePrefix, identity, next);
  return next;
}

/** 按面板域和路径身份隔离的侧栏折叠偏好。 */
export function usePanelSidebarCollapsed(
  storagePrefix: string,
  identity: string | null
): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsedState] = useState(() =>
    readPanelSidebarCollapsed(storagePrefix, identity)
  );

  useEffect(() => {
    setCollapsedState(readPanelSidebarCollapsed(storagePrefix, identity));
  }, [identity, storagePrefix]);

  useEffect(() => {
    const onPreference = (event: Event) => {
      const detail = (event as CustomEvent<PanelSidebarCollapsedEventDetail>)
        .detail;
      if (
        detail?.storagePrefix === storagePrefix &&
        detail.identity === identity
      ) {
        setCollapsedState(detail.collapsed);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (!(identity && event.key === preferenceKey(storagePrefix, identity))) {
        return;
      }
      setCollapsedState(event.newValue === "true");
    };
    globalThis.addEventListener(PANEL_SIDEBAR_COLLAPSED_EVENT, onPreference);
    globalThis.addEventListener("storage", onStorage);
    return () => {
      globalThis.removeEventListener(
        PANEL_SIDEBAR_COLLAPSED_EVENT,
        onPreference
      );
      globalThis.removeEventListener("storage", onStorage);
    };
  }, [identity, storagePrefix]);

  const setCollapsed = useCallback(
    (nextCollapsed: boolean) => {
      setCollapsedState(nextCollapsed);
      if (identity) {
        writePanelSidebarCollapsed(storagePrefix, identity, nextCollapsed);
      }
    },
    [identity, storagePrefix]
  );

  return [collapsed, setCollapsed];
}
