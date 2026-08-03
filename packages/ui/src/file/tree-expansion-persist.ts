/**
 * 目录树展开态持久化（localStorage）。
 *
 * 展开态是纯用户偏好：写盘失败、存储不可用、载荷损坏都只降级为「回到默认展开
 * 策略」，绝不能让目录树本身失败。
 */
import type { TreeExpansionAuthority } from "./tree-expansion-authority.ts";

/** 每个作用域的落盘路径上限，避免巨仓把 localStorage 撑爆。 */
const DEFAULT_MAX_PATHS = 500;
const DEFAULT_WRITE_DEBOUNCE_MS = 300;

export interface TreeExpansionPersistenceOptions {
  readonly maxPaths?: number;
  readonly writeDebounceMs?: number;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 超限时保留靠近根的路径：根附近的折叠对可见结构影响最大。 */
function trimPaths(paths: readonly string[], maxPaths: number): string[] {
  if (paths.length <= maxPaths) {
    return [...paths];
  }
  const sorted = [...paths].sort(
    (left, right) =>
      left.split("/").length - right.split("/").length ||
      left.localeCompare(right)
  );
  return sorted.slice(0, maxPaths);
}

export function readTreeExpansion(storageKey: string): unknown {
  const raw = storage()?.getItem(storageKey);
  if (raw == null || raw.length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function writeTreeExpansion(
  storageKey: string,
  authority: TreeExpansionAuthority,
  maxPaths: number = DEFAULT_MAX_PATHS
): void {
  const json = authority.toJSON();
  const payload = {
    ...json,
    collapsed: trimPaths(json.collapsed, maxPaths),
    expanded: trimPaths(json.expanded, maxPaths),
  };
  try {
    storage()?.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // Preference persistence must not break the tree.
  }
}

/** 载入既有意图并订阅后续变更；返回解绑函数（解绑时冲刷未落盘的改动）。 */
export function bindTreeExpansionPersistence(
  storageKey: string,
  authority: TreeExpansionAuthority,
  options: TreeExpansionPersistenceOptions = {}
): () => void {
  const maxPaths = options.maxPaths ?? DEFAULT_MAX_PATHS;
  const debounceMs = options.writeDebounceMs ?? DEFAULT_WRITE_DEBOUNCE_MS;
  const existing = readTreeExpansion(storageKey);
  if (existing != null) {
    authority.loadJSON(existing, "restore");
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const scheduleWrite = () => {
    if (timer != null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      writeTreeExpansion(storageKey, authority, maxPaths);
    }, debounceMs);
  };

  const unsubscribe = authority.subscribe(scheduleWrite);
  return () => {
    unsubscribe();
    if (timer != null) {
      clearTimeout(timer);
      writeTreeExpansion(storageKey, authority, maxPaths);
    }
  };
}
