import type { PierCommandErrorCode } from "@shared/contracts/commands.ts";
import type { DockviewApi } from "dockview-react";
import {
  type DockviewGridBranchLike,
  type DockviewOrientationLike,
  getDockviewSplitviewContentSize,
  isDockviewGridBranchLike,
  readDockviewGridRoot,
} from "./dockview-grid-internals.ts";

export interface PanelSizeMutationResult {
  code?: PierCommandErrorCode;
  message?: string;
  ok: boolean;
}

interface GridPathEntry {
  branch: DockviewGridBranchLike;
  childIndex: number;
}

function pushPanelId(ids: string[], value: unknown): void {
  if (typeof value === "string" && value.length > 0) {
    ids.push(value);
  }
}

function panelIdsOfLeaf(node: unknown): string[] {
  if (!node || typeof node !== "object") {
    return [];
  }
  const candidate = node as {
    id?: unknown;
    panelIds?: unknown;
    panels?: unknown;
    view?: { id?: unknown; panels?: unknown };
  };
  const ids: string[] = [];
  if (Array.isArray(candidate.panelIds)) {
    for (const id of candidate.panelIds) {
      pushPanelId(ids, id);
    }
  }
  let panels: unknown[] = [];
  if (Array.isArray(candidate.panels)) {
    panels = candidate.panels;
  } else if (Array.isArray(candidate.view?.panels)) {
    panels = candidate.view.panels;
  }
  for (const panel of panels) {
    if (panel && typeof panel === "object" && "id" in panel) {
      pushPanelId(ids, panel.id);
    }
  }
  pushPanelId(ids, candidate.view?.id);
  pushPanelId(ids, candidate.id);
  return ids;
}

function groupIdOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("id" in value)) {
    return;
  }
  return typeof value.id === "string" && value.id.length > 0
    ? value.id
    : undefined;
}

function leafContainsPanel(
  node: unknown,
  panelId: string,
  group: unknown
): boolean {
  if (group && node && typeof node === "object" && "view" in node) {
    const view = (node as { view?: unknown }).view;
    if (view === group) {
      return true;
    }
    const viewId = groupIdOf(view);
    const groupId = groupIdOf(group);
    if (viewId && groupId && viewId === groupId) {
      return true;
    }
  }
  return panelIdsOfLeaf(node).includes(panelId);
}

function findPanelPath(
  root: unknown,
  panelId: string,
  group: unknown
): GridPathEntry[] | null {
  function walk(node: unknown, path: GridPathEntry[]): GridPathEntry[] | null {
    if (isDockviewGridBranchLike(node)) {
      for (let index = 0; index < node.children.length; index += 1) {
        const found = walk(node.children[index], [
          ...path,
          { branch: node, childIndex: index },
        ]);
        if (found) {
          return found;
        }
      }
      return null;
    }
    return leafContainsPanel(node, panelId, group) ? path : null;
  }
  return walk(root, []);
}

function nearestAxisEntry(
  path: GridPathEntry[],
  axis: DockviewOrientationLike
): GridPathEntry | undefined {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const entry = path[index];
    if (entry?.branch.orientation === axis) {
      return entry;
    }
  }
  return;
}

function panelExists(api: DockviewApi, panelId: string): boolean {
  if (typeof api.getPanel === "function" && api.getPanel(panelId)) {
    return true;
  }
  return api.panels.some((panel) => panel.id === panelId);
}

function groupForPanel(api: DockviewApi, panelId: string): unknown {
  if (typeof api.getPanel !== "function") {
    return;
  }
  return api.getPanel(panelId)?.group;
}

function splitParentUnavailable(panelId: string): PanelSizeMutationResult {
  return {
    code: "platform_unavailable",
    message: `panel split parent is unavailable: ${panelId}`,
    ok: false,
  };
}

function resizeChildToRatio(entry: GridPathEntry, ratio: number): void {
  const total = getDockviewSplitviewContentSize(entry.branch);
  if (!(total > 0)) {
    return;
  }
  entry.branch.splitview.resizeView(
    entry.childIndex,
    Math.max(0, Math.round(total * ratio))
  );
}

function equalizeDirectChildren(branch: DockviewGridBranchLike): void {
  const count = branch.children.length;
  if (count <= 1) {
    return;
  }
  const total = getDockviewSplitviewContentSize(branch);
  if (!(total > 0)) {
    return;
  }
  const even = Math.floor(total / count);
  let assigned = 0;
  for (let index = 0; index < count - 1; index += 1) {
    assigned += even;
    branch.splitview.resizeView(index, even);
  }
  branch.splitview.resizeView(count - 1, Math.max(0, total - assigned));
}

function missingPanel(panelId: string): PanelSizeMutationResult {
  return {
    code: "not_found",
    message: `panel not found: ${panelId}`,
    ok: false,
  };
}

export function setDockviewPanelSize(
  api: DockviewApi,
  input: {
    heightRatio?: number;
    panelId: string;
    widthRatio?: number;
  }
): PanelSizeMutationResult {
  if (!panelExists(api, input.panelId)) {
    return missingPanel(input.panelId);
  }
  const root = readDockviewGridRoot(api);
  const path = findPanelPath(
    root,
    input.panelId,
    groupForPanel(api, input.panelId)
  );
  if (!path) {
    return splitParentUnavailable(input.panelId);
  }
  if (input.widthRatio !== undefined) {
    const entry = nearestAxisEntry(path, "HORIZONTAL");
    if (entry) {
      resizeChildToRatio(entry, input.widthRatio);
    }
  }
  if (input.heightRatio !== undefined) {
    const entry = nearestAxisEntry(path, "VERTICAL");
    if (entry) {
      resizeChildToRatio(entry, input.heightRatio);
    }
  }
  return { ok: true };
}

export function equalizeDockviewPanelGroup(
  api: DockviewApi,
  input: {
    axis: "horizontal" | "vertical";
    panelIds: readonly string[];
  }
): PanelSizeMutationResult {
  for (const panelId of input.panelIds) {
    if (!panelExists(api, panelId)) {
      return missingPanel(panelId);
    }
  }
  const root = readDockviewGridRoot(api);
  const axis: DockviewOrientationLike =
    input.axis === "horizontal" ? "HORIZONTAL" : "VERTICAL";
  const paths: Array<GridPathEntry[] | null> = input.panelIds.map((panelId) =>
    findPanelPath(root, panelId, groupForPanel(api, panelId))
  );
  if (paths.some((path) => path === null)) {
    const missing = input.panelIds.find(
      (_panelId, index) => paths[index] === null
    );
    return splitParentUnavailable(missing ?? input.panelIds[0] ?? "panel");
  }
  const locatedPaths = paths.filter(
    (path): path is GridPathEntry[] => path !== null
  );
  const branches = locatedPaths.map(
    (path) => nearestAxisEntry(path, axis)?.branch ?? null
  );
  const first = branches[0];
  if (!first) {
    const other = locatedPaths[0] ?? [];
    const sameLeaf = locatedPaths.every((path) => {
      if (path.length !== other.length) {
        return false;
      }
      if (path.length === 0) {
        return true;
      }
      const last = path.at(-1);
      const otherLast = other.at(-1);
      return (
        last?.branch === otherLast?.branch &&
        last?.childIndex === otherLast?.childIndex
      );
    });
    if (sameLeaf) {
      return { ok: true };
    }
    return {
      code: "invalid_command",
      message: "panels are not in a shared split on the requested axis",
      ok: false,
    };
  }
  if (branches.some((branch) => branch !== first)) {
    return {
      code: "invalid_command",
      message: "panels are not in a shared split on the requested axis",
      ok: false,
    };
  }
  equalizeDirectChildren(first);
  return { ok: true };
}
