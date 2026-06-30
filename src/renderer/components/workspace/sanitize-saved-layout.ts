import type { SerializedDockview } from "dockview-react";

interface SerializedGroupState {
  activeView?: string;
  id?: string;
  views?: readonly string[];
  // dockview 保留字段(headerLocation/maximised 等)— 用 unknown 让 ...spread 透传。
  [key: string]: unknown;
}

interface SerializedGridLeaf {
  data?: SerializedGroupState;
  type: "leaf";
}

interface SerializedGridBranch {
  data?: readonly SerializedGridNode[];
  type: "branch";
}

type SerializedGridNode = SerializedGridBranch | SerializedGridLeaf;

interface SerializedFloatingGroup {
  data?: SerializedGroupState;
}

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

function sanitizeGroupViews(
  group: SerializedGroupState,
  keepPanelIds: ReadonlySet<string>
): SerializedGroupState | null {
  const views = group.views ?? [];
  const keptViews = views.filter((panelId) => keepPanelIds.has(panelId));
  if (keptViews.length === 0) {
    return null;
  }
  // keptViews.length >= 1 已保证,fallback 取最后一项不会 undefined;
  // noUncheckedIndexedAccess 看不出这点,显式收窄。
  const fallbackActive: string = keptViews.at(-1) ?? keptViews[0] ?? "";
  const activeView =
    group.activeView && keepPanelIds.has(group.activeView)
      ? group.activeView
      : fallbackActive;
  return {
    ...group,
    activeView,
    views: keptViews,
  };
}

function pruneNode(
  node: unknown,
  keepPanelIds: ReadonlySet<string>
): SerializedGridNode | null {
  if (isLeaf(node)) {
    if (!node.data) {
      return null;
    }
    const sanitized = sanitizeGroupViews(node.data, keepPanelIds);
    if (!sanitized) {
      return null;
    }
    return { ...node, data: sanitized };
  }
  if (isBranch(node)) {
    const children = (node.data ?? [])
      .map((child) => pruneNode(child, keepPanelIds))
      .filter((child): child is SerializedGridNode => child !== null);
    if (children.length === 0) {
      return null;
    }
    return { ...node, data: children };
  }
  return null;
}

function pruneFloatingGroups(
  groups: unknown,
  keepPanelIds: ReadonlySet<string>
): SerializedFloatingGroup[] | undefined {
  if (!Array.isArray(groups)) {
    return;
  }
  const pruned: SerializedFloatingGroup[] = [];
  for (const group of groups) {
    if (typeof group !== "object" || group === null) {
      continue;
    }
    const rawData = (group as { data?: unknown }).data;
    if (typeof rawData !== "object" || rawData === null) {
      continue;
    }
    const sanitized = sanitizeGroupViews(
      rawData as SerializedGroupState,
      keepPanelIds
    );
    if (sanitized) {
      pruned.push({ ...(group as SerializedFloatingGroup), data: sanitized });
    }
  }
  return pruned;
}

/**
 * 剔除 saved layout 中引用了未注册 dockview component 的 panel + grid/floating
 * 引用。用于禁用插件后重启的边界:旧布局存了 plugin panel,但 component 已 unregister,
 * 直接 fromJSON 会抛错 → workspace 回退 default,连其它正常 panel 也丢。
 * 这里剪掉无效引用后再 fromJSON,尽量保住用户其它 panel。
 *
 * 注意 dockview 序列化里 grid leaf 的 data.id 是"组 id"(顺序号),data.views 才是
 * "panel id 数组" —— sanitize 必须在 views[] 层操作,不能用 leaf.data.id 比对 panel id。
 *
 * 输入若结构异常或没有 panel 能保留,返回 null —— 调用方走 default fallback。
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

  if (keepPanelIds.size === 0) {
    return null;
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

  const sanitized: Record<string, unknown> = {
    ...root,
    grid: { ...(grid as object), root: prunedRoot },
    panels: sanitizedPanels,
  };
  const floatingGroups = pruneFloatingGroups(root.floatingGroups, keepPanelIds);
  if (floatingGroups !== undefined) {
    sanitized.floatingGroups = floatingGroups;
  }
  const popoutGroups = pruneFloatingGroups(root.popoutGroups, keepPanelIds);
  if (popoutGroups !== undefined) {
    sanitized.popoutGroups = popoutGroups;
  }

  return sanitized as unknown as SerializedDockview;
}
