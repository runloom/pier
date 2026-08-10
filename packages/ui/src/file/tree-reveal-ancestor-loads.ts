import type { FileTreeRefs } from "./tree-internal.ts";

/**
 * When reveal targets a path not yet projected, list missing ancestors via
 * onLoadDirectory so pending retries can finish.
 */
export function requestRevealAncestorLoads(
  path: string,
  readRefs: () => FileTreeRefs
): void {
  if (path.length === 0) {
    return;
  }
  const onLoadDirectory = readRefs().onLoadDirectory;
  if (!onLoadDirectory) {
    return;
  }
  const itemsByPath = readRefs().itemsByPath;
  const segments = path.split("/").filter(Boolean);
  for (let index = 1; index < segments.length; index += 1) {
    const ancestorPath = segments.slice(0, index).join("/");
    const ancestorItem = itemsByPath.get(ancestorPath);
    if (ancestorItem?.kind !== "directory") {
      if (index > 1) {
        const parentPath = segments.slice(0, index - 1).join("/");
        if (itemsByPath.get(parentPath)?.kind === "directory") {
          Promise.resolve(onLoadDirectory(parentPath)).catch(() => undefined);
        }
      } else if (!ancestorItem) {
        Promise.resolve(onLoadDirectory("")).catch(() => undefined);
      }
      break;
    }
    const prefix = `${ancestorPath}/`;
    let hasChild = false;
    for (const item of itemsByPath.values()) {
      if (item.path.startsWith(prefix) && item.path !== ancestorPath) {
        hasChild = true;
        break;
      }
    }
    if (!hasChild) {
      Promise.resolve(onLoadDirectory(ancestorPath)).catch(() => undefined);
    }
  }
}
