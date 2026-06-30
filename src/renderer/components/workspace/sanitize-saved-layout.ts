import type { SerializedDockview } from "dockview-react";

interface SerializedGridLeaf {
  data?: { id?: string };
  type: "leaf";
}

interface SerializedGridBranch {
  data?: readonly SerializedGridNode[];
  type: "branch";
}

type SerializedGridNode = SerializedGridBranch | SerializedGridLeaf;

function isLeaf(node: unknown): node is SerializedGridLeaf {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: unknown }).type === "leaf"
  );
}

function isBranch(node: unknown): node is SerializedGridBranch {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: unknown }).type === "branch"
  );
}

function pruneNode(
  node: unknown,
  keepIds: ReadonlySet<string>
): unknown | null {
  if (isLeaf(node)) {
    const id = node.data?.id;
    if (!id || keepIds.has(id)) {
      return node;
    }
    return null;
  }
  if (isBranch(node)) {
    const children = (node.data ?? [])
      .map((child) => pruneNode(child, keepIds))
      .filter((child): child is SerializedGridNode => child !== null);
    if (children.length === 0) {
      return null;
    }
    return { ...node, data: children };
  }
  return node;
}

/**
 * 剔除 saved layout 中引用了未知 dockview component 的 panel + grid 引用。
 * 用于禁用插件后重启的边界:旧布局存了 plugin panel,但 component 已 unregister,
 * 直接 fromJSON 会抛错 → workspace 回退 default,连其它正常 panel 也丢。
 * 这里剪掉无效引用后再 fromJSON,尽量保住用户其它 panel。
 *
 * 输入若结构异常,返回 null —— 调用方走 default fallback。
 */
export function sanitizeSavedLayout(
  saved: unknown,
  knownComponents: ReadonlySet<string>
): SerializedDockview | null {
  if (typeof saved !== "object" || saved === null) {
    return null;
  }
  const root = saved as Record<string, unknown>;
  const panels = root.panels;
  if (typeof panels !== "object" || panels === null) {
    return null;
  }

  const keepPanelIds = new Set<string>();
  const sanitizedPanels: Record<string, unknown> = {};
  for (const [panelId, state] of Object.entries(
    panels as Record<string, unknown>
  )) {
    const contentComponent = (state as { contentComponent?: unknown })
      ?.contentComponent;
    if (
      typeof contentComponent === "string" &&
      knownComponents.has(contentComponent)
    ) {
      sanitizedPanels[panelId] = state;
      keepPanelIds.add(panelId);
    }
  }

  const grid = root.grid;
  if (typeof grid !== "object" || grid === null) {
    return null;
  }
  const gridRoot = (grid as { root?: unknown }).root;
  const prunedRoot = pruneNode(gridRoot, keepPanelIds);
  if (prunedRoot === null) {
    return null;
  }

  return {
    ...root,
    grid: { ...(grid as object), root: prunedRoot },
    panels: sanitizedPanels,
  } as SerializedDockview;
}
