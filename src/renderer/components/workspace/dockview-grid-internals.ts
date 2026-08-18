import type { DockviewApi } from "dockview-react";

export interface DockviewSplitviewLike {
  readonly contentSize?: number;
  distributeViewSizes(): void;
  getViewSize(index: number): number;
  resizeView(index: number, size: number): void;
}

export type DockviewOrientationLike = "HORIZONTAL" | "VERTICAL";

export interface DockviewGridBranchLike {
  children: unknown[];
  orientation: DockviewOrientationLike;
  splitview: DockviewSplitviewLike;
}

interface DockviewComponentGridLike {
  gridview?: { root?: unknown };
}

export function isDockviewGridBranchLike(
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

export function readDockviewGridRoot(api: DockviewApi): unknown {
  return (api as unknown as { component?: DockviewComponentGridLike }).component
    ?.gridview?.root;
}

export function assertInternalDockviewGridRoot(
  api: DockviewApi
): DockviewGridBranchLike {
  const root = readDockviewGridRoot(api);
  if (!isDockviewGridBranchLike(root)) {
    throw new Error(
      "[workspace] Dockview equalize internals are unavailable: component.gridview.root splitview API is missing."
    );
  }
  return root;
}

export function getDockviewSplitviewContentSize(
  node: DockviewGridBranchLike
): number {
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
