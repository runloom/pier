/**
 * Files 与 Git 审查共用的左侧目录树宽度。
 * 同一套 FilePanelLayout 壳，用户拖一次应两边一起记住。
 */
export const FILE_PANEL_DEFAULT_SIDEBAR_WIDTH_PX = 256;
export const FILE_PANEL_MIN_SIDEBAR_WIDTH_PX = 170;
export const FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY =
  "pier.filePanel.treeWidthPx";

/** 旧键只在统一键缺失时回读；Files 优先于 Git。 */
export const FILE_PANEL_LEGACY_SIDEBAR_WIDTH_STORAGE_KEYS = [
  "pier.files.filePanel.treeWidthPx",
  "pier.git.review.treeWidthPx",
] as const;

type SidebarWidthListener = (widthPx: number) => void;

const listenersByKey = new Map<string, Set<SidebarWidthListener>>();

function parseStoredWidthPx(raw: string | null): number | null {
  if (raw == null) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isUsableWidth(widthPx: number, minWidth: number): boolean {
  return Number.isFinite(widthPx) && widthPx >= minWidth;
}

function notifySidebarWidth(storageKey: string, widthPx: number): void {
  const listeners = listenersByKey.get(storageKey);
  if (listeners === undefined) {
    return;
  }
  for (const listener of listeners) {
    listener(widthPx);
  }
}

export function readSidebarWidth(
  storageKey: string,
  defaultWidth: number,
  minWidth: number
): number {
  try {
    const stored = parseStoredWidthPx(
      globalThis.localStorage?.getItem(storageKey) ?? null
    );
    if (stored != null && isUsableWidth(stored, minWidth)) {
      return stored;
    }
    if (storageKey === FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY) {
      for (const legacyKey of FILE_PANEL_LEGACY_SIDEBAR_WIDTH_STORAGE_KEYS) {
        const migrated = parseStoredWidthPx(
          globalThis.localStorage?.getItem(legacyKey) ?? null
        );
        if (migrated != null && isUsableWidth(migrated, minWidth)) {
          return migrated;
        }
      }
    }
  } catch {
    // localStorage 不可用时保持默认宽度。
  }
  return defaultWidth;
}

/** 统一键缺失时把旧 Files / Git 键抄过来；不把默认 256 当成用户偏好写入。 */
export function persistMigratedSidebarWidth(
  storageKey: string,
  minWidth: number
): void {
  if (storageKey !== FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY) {
    return;
  }
  try {
    const existing = parseStoredWidthPx(
      globalThis.localStorage?.getItem(storageKey) ?? null
    );
    if (existing != null && isUsableWidth(existing, minWidth)) {
      return;
    }
    for (const legacyKey of FILE_PANEL_LEGACY_SIDEBAR_WIDTH_STORAGE_KEYS) {
      const migrated = parseStoredWidthPx(
        globalThis.localStorage?.getItem(legacyKey) ?? null
      );
      if (migrated != null && isUsableWidth(migrated, minWidth)) {
        writeSidebarWidth(storageKey, migrated);
        return;
      }
    }
  } catch {
    // 迁移失败保持只读回退。
  }
}

export function writeSidebarWidth(storageKey: string, widthPx: number): void {
  const rounded = Math.round(widthPx);
  try {
    const previous = parseStoredWidthPx(
      globalThis.localStorage?.getItem(storageKey) ?? null
    );
    if (previous === rounded) {
      return;
    }
    globalThis.localStorage?.setItem(storageKey, String(rounded));
  } catch {
    // 偏好持久化失败不影响面板使用；同窗监听仍要同步。
  }
  notifySidebarWidth(storageKey, rounded);
}

export function subscribeSidebarWidth(
  storageKey: string,
  listener: SidebarWidthListener
): () => void {
  let listeners = listenersByKey.get(storageKey);
  if (listeners === undefined) {
    listeners = new Set();
    listenersByKey.set(storageKey, listeners);
  }
  listeners.add(listener);

  const onStorage = (event: StorageEvent): void => {
    if (event.key !== storageKey) {
      return;
    }
    const parsed = parseStoredWidthPx(event.newValue);
    if (parsed == null) {
      return;
    }
    listener(parsed);
  };
  globalThis.addEventListener?.("storage", onStorage);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersByKey.delete(storageKey);
    }
    globalThis.removeEventListener?.("storage", onStorage);
  };
}

/** Test / hot-reload helper. */
export function resetFilePanelSidebarWidthListenersForTests(): void {
  listenersByKey.clear();
}
