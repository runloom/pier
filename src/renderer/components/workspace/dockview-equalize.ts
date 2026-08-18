import type { DockviewApi } from "dockview-react";
import { prepareTabStripScrollsForMaximizeLayoutMutation } from "@/lib/workspace/tab-strip-scroll.ts";
import {
  assertInternalDockviewGridRoot,
  type DockviewOrientationLike,
  getDockviewSplitviewContentSize,
  isDockviewGridBranchLike,
} from "./dockview-grid-internals.ts";

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
    // Same P1 entry as toggle maximize: snapshot before exitMaximizedGroup.
    prepareTabStripScrollsForMaximizeLayoutMutation();
    api.exitMaximizedGroup();
  }
  return equalizeDockviewBranchLive(assertInternalDockviewGridRoot(api));
}
