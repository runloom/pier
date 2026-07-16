import { useCallback, useEffect, useState } from "react";

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

function readCollapsed(
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
}

/** 按面板域和路径身份隔离的侧栏折叠偏好。 */
export function usePanelSidebarCollapsed(
  storagePrefix: string,
  identity: string | null
): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsedState] = useState(() =>
    readCollapsed(storagePrefix, identity)
  );

  useEffect(() => {
    setCollapsedState(readCollapsed(storagePrefix, identity));
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
