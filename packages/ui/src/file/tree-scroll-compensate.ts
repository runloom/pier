import type { PierFileTreeScrollSnapshot } from "./tree-types.ts";

/**
 * Path-set ops that may change tree projection (mirrors @pierre/trees batch ops).
 */
export type FileTreeScrollMutationOp =
  | { readonly path: string; readonly type: "add" }
  | { readonly path: string; readonly type: "remove" }
  | { readonly from: string; readonly to: string; readonly type: "move" };

export interface ShouldCompensateScrollInput {
  readonly mutation: readonly FileTreeScrollMutationOp[];
  /** Reveal owns scrollToPath. */
  readonly revealActive?: boolean;
  /** Search materialize: do not chase viewport with compensate. */
  readonly searchActive?: boolean;
  readonly snapshot: PierFileTreeScrollSnapshot | null;
  /** model.resetPaths residual path — always compensate once when allowed. */
  readonly usedResetPaths?: boolean;
  /** User gesture claim window. */
  readonly userScrolling?: boolean;
}

function normalizePath(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function pathSegments(path: string): string[] {
  const normalized = normalizePath(path);
  return normalized.length === 0 ? [] : normalized.split("/");
}

/** True when `ancestor` is a strict ancestor of `path` (or equal when allowEqual). */
function isAncestorPath(
  ancestor: string,
  path: string,
  allowEqual: boolean
): boolean {
  const a = normalizePath(ancestor);
  const p = normalizePath(path);
  if (a.length === 0) {
    return allowEqual || p.length > 0;
  }
  if (a === p) {
    return allowEqual;
  }
  return p.startsWith(`${a}/`);
}

/**
 * DFS preorder under lexicographic path segments: `left` appears before `right`.
 * Ancestors sort before descendants.
 *
 * **Known bias (gold §/G2):** this is not `@pierre/trees` sibling collator
 * (dirs-before-files / locale). Prefer false negatives (skip compensate →
 * possible micro-jump) over false positives (pin against the user).
 */
export function isBeforeInTreeOrder(left: string, right: string): boolean {
  const leftSegments = pathSegments(left);
  const rightSegments = pathSegments(right);
  const shared = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < shared; index += 1) {
    const leftSegment = leftSegments[index];
    const rightSegment = rightSegments[index];
    if (leftSegment !== rightSegment) {
      return (leftSegment ?? "") < (rightSegment ?? "");
    }
  }
  return leftSegments.length < rightSegments.length;
}

/**
 * Adding/removing this path may change layout above the anchor row.
 * Descendants of the anchor sit below the row and do not need compensate.
 */
function pathMayAffectAboveAnchor(path: string, anchor: string): boolean {
  if (isAncestorPath(anchor, path, true)) {
    // Self or under anchor → at/below the anchor row in projection.
    return normalizePath(path) === normalizePath(anchor);
  }
  if (isAncestorPath(path, anchor, false)) {
    return true;
  }
  return isBeforeInTreeOrder(path, anchor);
}

/**
 * Whether path-sync may write scrollTop once to keep the viewport stable.
 * Prefer false (micro-jump) over true (risk of fighting the user).
 */
export function shouldCompensateScroll(
  input: ShouldCompensateScrollInput
): boolean {
  if (input.userScrolling === true || input.revealActive === true) {
    return false;
  }
  if (input.snapshot === null) {
    return false;
  }
  if (input.searchActive === true && input.usedResetPaths !== true) {
    return false;
  }
  if (input.usedResetPaths === true) {
    return true;
  }
  if (input.mutation.length === 0) {
    return false;
  }

  if (input.snapshot.kind === "position") {
    // No mounted anchor row: only shrink/move risk warrants a pin.
    return input.mutation.some(
      (op) => op.type === "remove" || op.type === "move"
    );
  }

  const anchorPath = normalizePath(input.snapshot.path);
  for (const op of input.mutation) {
    if (op.type === "add") {
      if (pathMayAffectAboveAnchor(op.path, anchorPath)) {
        return true;
      }
      continue;
    }
    if (op.type === "remove") {
      if (pathMayAffectAboveAnchor(op.path, anchorPath)) {
        return true;
      }
      continue;
    }
    if (
      pathMayAffectAboveAnchor(op.from, anchorPath) ||
      pathMayAffectAboveAnchor(op.to, anchorPath)
    ) {
      return true;
    }
  }
  return false;
}
