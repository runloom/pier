import type { PanelContext } from "@shared/contracts/panel.ts";
import { splitAbsoluteDiskTarget } from "@shared/system-open-guard.ts";

function isSamePathOrDescendant(entryPath: string, path: string): boolean {
  return entryPath === path || entryPath.startsWith(`${path}/`);
}

export function terminalOpenUrlAnchors(
  context: PanelContext | null | undefined
): string[] {
  if (!context) {
    return [];
  }
  return [
    context.projectRootPath,
    context.worktreeRoot,
    context.gitRoot,
    context.cwd,
    context.openedPath,
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
}

export function longestCoveringAnchor(
  path: string,
  anchors: readonly string[]
): string | null {
  let best: string | null = null;
  for (const anchor of anchors) {
    if (!isSamePathOrDescendant(path, anchor)) {
      continue;
    }
    if (!best || anchor.length > best.length) {
      best = anchor;
    }
  }
  return best;
}

export function toRootRelative(
  anchor: string,
  absolutePath: string
): string | null {
  const from = anchor.replace(/\\/g, "/").replace(/\/+$/, "");
  const to = absolutePath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (to === from) {
    return "";
  }
  const prefix = `${from}/`;
  if (!to.startsWith(prefix)) {
    return null;
  }
  return to.slice(prefix.length);
}

export interface TerminalDiskTargetParts {
  absolutePath: string;
  relativePath: string;
  root: string;
}

/**
 * Prefer the longest panel anchor as disk root so Files panel identity matches
 * project/worktree open paths. Falls back to parent-dir + basename.
 */
export function diskTargetPartsForAbsolute(
  absolutePath: string,
  panelContext: PanelContext | null | undefined
): TerminalDiskTargetParts {
  const anchors = terminalOpenUrlAnchors(panelContext);
  const anchor = longestCoveringAnchor(absolutePath, anchors);
  if (anchor) {
    const relativePath = toRootRelative(anchor, absolutePath);
    if (relativePath !== null) {
      return { absolutePath, relativePath, root: anchor };
    }
  }
  const fallback = splitAbsoluteDiskTarget(absolutePath);
  return {
    absolutePath,
    relativePath: fallback.path,
    root: fallback.root,
  };
}

/** Align panel context projectRootPath with the disk source root. */
export function withTerminalOpenAnchor(
  context: PanelContext | null,
  anchor: string
): PanelContext | null {
  if (!context) {
    return null;
  }
  return {
    ...context,
    projectRootPath: anchor,
  };
}
