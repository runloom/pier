import type { DockviewApi } from "dockview-react";

interface DockviewSplitviewLike {
  readonly contentSize?: number;
  distributeViewSizes(): void;
  getViewSize(index: number): number;
  resizeView(index: number, size: number): void;
}

type DockviewOrientationLike = "HORIZONTAL" | "VERTICAL";

interface DockviewGridBranchLike {
  children: unknown[];
  orientation: DockviewOrientationLike;
  splitview: DockviewSplitviewLike;
}

interface DockviewComponentEqualizeLike {
  gridview?: { root?: unknown };
}

function isDockviewGridBranchLike(
  value: unknown
): value is DockviewGridBranchLike {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as {
    children?: unknown;
    orientation?: unknown;
    splitview?: {
      distributeViewSizes?: unknown;
      getViewSize?: unknown;
      resizeView?: unknown;
    };
  };
  return (
    Array.isArray(candidate.children) &&
    (candidate.orientation === "HORIZONTAL" ||
      candidate.orientation === "VERTICAL") &&
    typeof candidate.splitview?.distributeViewSizes === "function" &&
    typeof candidate.splitview.getViewSize === "function" &&
    typeof candidate.splitview.resizeView === "function"
  );
}

function assertInternalDockviewEqualizeApi(
  api: DockviewApi
): DockviewGridBranchLike {
  const root = (api as unknown as { component?: DockviewComponentEqualizeLike })
    .component?.gridview?.root;
  if (!isDockviewGridBranchLike(root)) {
    throw new Error(
      "[workspace] Dockview equalize internals are unavailable: component.gridview.root splitview API is missing."
    );
  }
  return root;
}

function countDockviewSpan(
  node: unknown,
  axis: DockviewOrientationLike
): number {
  if (!isDockviewGridBranchLike(node)) {
    return 1;
  }
  if (node.children.length === 0) {
    return 1;
  }
  const childSpans = node.children.map((child) =>
    countDockviewSpan(child, axis)
  );
  if (node.orientation === axis) {
    return childSpans.reduce((sum, span) => sum + span, 0);
  }
  return Math.max(...childSpans);
}

function getDockviewSplitviewContentSize(node: DockviewGridBranchLike): number {
  const explicit = node.splitview.contentSize;
  if (
    typeof explicit === "number" &&
    Number.isFinite(explicit) &&
    explicit > 0
  ) {
    return explicit;
  }
  return node.children.reduce<number>((sum, _child, index) => {
    const size = node.splitview.getViewSize(index);
    return sum + (Number.isFinite(size) && size > 0 ? size : 0);
  }, 0);
}

function equalizeDockviewBranchLive(node: unknown): boolean {
  if (!isDockviewGridBranchLike(node)) {
    return false;
  }
  let didEqualize = false;
  if (node.children.length > 1) {
    const weights = node.children.map((child) =>
      countDockviewSpan(child, node.orientation)
    );
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const totalSize = getDockviewSplitviewContentSize(node);
    if (totalWeight > 0 && totalSize > 0) {
      let assigned = 0;
      for (let index = 0; index < node.children.length - 1; index += 1) {
        const weight = weights[index] ?? 0;
        const target = Math.round((totalSize * weight) / totalWeight);
        assigned += target;
        node.splitview.resizeView(index, target);
      }
      const lastIndex = node.children.length - 1;
      node.splitview.resizeView(lastIndex, Math.max(0, totalSize - assigned));
      didEqualize = true;
    } else {
      node.splitview.distributeViewSizes();
      didEqualize = true;
    }
  }
  for (const child of node.children) {
    didEqualize = equalizeDockviewBranchLive(child) || didEqualize;
  }
  return didEqualize;
}

export function equalizeDockviewSplits(api: DockviewApi): boolean {
  if (api.hasMaximizedGroup()) {
    api.exitMaximizedGroup();
  }
  return equalizeDockviewBranchLive(assertInternalDockviewEqualizeApi(api));
}
