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

const WORKBENCH_COMPONENT = "workbench";
const LEGACY_WORKBENCH_COMPONENTS = new Set(["dashboard", "mission-control"]);
const LEGACY_WORKBENCH_TITLES = new Set(["Dashboard", "Mission Control"]);

function migrateWorkbenchPanelState(state: unknown): {
  migrated: boolean;
  state: unknown;
} {
  if (typeof state !== "object" || state === null) {
    return { migrated: false, state };
  }
  const record = state as Record<string, unknown>;
  if (
    typeof record.contentComponent !== "string" ||
    !LEGACY_WORKBENCH_COMPONENTS.has(record.contentComponent)
  ) {
    return { migrated: false, state };
  }
  return {
    migrated: true,
    state: {
      ...record,
      contentComponent: WORKBENCH_COMPONENT,
      ...(typeof record.title === "string" &&
      LEGACY_WORKBENCH_TITLES.has(record.title)
        ? { title: "Workbench" }
        : {}),
    },
  };
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

function resolveActiveGroup(
  original: unknown,
  surviving: ReadonlySet<string>
): string | undefined {
  if (typeof original === "string" && surviving.has(original)) {
    return original;
  }
  return surviving.values().next().value;
}

function collectLeafGroupIds(node: unknown, out: Set<string>): void {
  if (isLeaf(node)) {
    const id = node.data?.id;
    if (typeof id === "string") {
      out.add(id);
    }
    return;
  }
  if (isBranch(node)) {
    for (const child of node.data ?? []) {
      collectLeafGroupIds(child, out);
    }
  }
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
 * 读取边界先把历史工作台 component/title 单向迁移为当前值，再剔除 saved layout
 * 中引用了未注册 dockview component 的 panel + grid/floating 引用。用于更名和
 * 禁用插件后重启的边界：旧布局不会继续写出旧工作台值；旧布局中的 plugin panel
 * 若已 unregister，也只剪掉无效引用，避免 fromJSON 失败后把其它正常 panel 一并丢失。
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
  let panelsPruned = false;
  let panelsMigrated = false;
  for (const [panelId, state] of Object.entries(
    panels as Record<string, unknown>
  )) {
    const migrated = migrateWorkbenchPanelState(state);
    panelsMigrated ||= migrated.migrated;
    const contentComponent = (
      migrated.state as { contentComponent?: unknown } | null
    )?.contentComponent;
    if (
      typeof contentComponent === "string" &&
      knownComponents.has(contentComponent)
    ) {
      sanitizedPanels[panelId] = migrated.state;
      keepPanelIds.add(panelId);
    } else {
      panelsPruned = true;
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
    // 已知局限:主 grid 完全空但 floating/popout 还有 survivor 时,本函数仍返 null;
    // dockview 不接受 root=null 的 grid,而合成最小合法 root 涉及 dockview 内部约束。
    // 此场景需要用户先把主 grid 弄空又留浮窗,概率极低,留待真实数据出现再处理。
    return null;
  }

  // 无 panel 被剪 → 透传原 layout,保留 maximizedNode / activeGroup 等用户状态。
  if (!(panelsPruned || panelsMigrated)) {
    return saved as SerializedDockview;
  }

  // 只有真实剪枝时才丢弃 maximizedNode。组件重命名不改变布局拓扑，
  // 原有最大化路径仍然有效，必须保留。
  let sanitizedGrid = grid as Record<string, unknown>;
  if (panelsPruned) {
    // maximizedNode 是最大化路径，剪枝可能让它指向无效 leaf，
    // 导致 fromJSON 抛错或最大化错误面板。
    const { maximizedNode: _, ...gridWithoutMaximized } = sanitizedGrid;
    sanitizedGrid = gridWithoutMaximized;
  }

  // activeGroup 可能指向被剪掉的 group。检测失效后改指存活 group，
  // 优先使用剪枝后 grid 的第一个 leaf。
  const survivingGroupIds = new Set<string>();
  collectLeafGroupIds(prunedRoot, survivingGroupIds);

  const sanitized: Record<string, unknown> = {
    ...root,
    grid: { ...sanitizedGrid, root: prunedRoot },
    panels: sanitizedPanels,
  };

  sanitized.activeGroup = resolveActiveGroup(
    (root as { activeGroup?: unknown }).activeGroup,
    survivingGroupIds
  );

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
