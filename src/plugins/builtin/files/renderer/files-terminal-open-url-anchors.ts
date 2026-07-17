import type { PanelContext } from "@shared/contracts/panel.ts";
import { isSamePathOrDescendant } from "./files-document-paths.ts";

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
