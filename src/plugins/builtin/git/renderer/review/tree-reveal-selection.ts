import type { PierFileTreeApi } from "@pier/ui/file/tree.tsx";

/**
 * Explicit tree orient: select the row and scroll it into the optimal viewport.
 * Does not open files; selection/open stays with the caller.
 *
 * Defer past the click handler. The tree controller owns pending retries;
 * replaying this explicit intent in another frame would override a newer scroll.
 */
export function revealGitReviewTreeSelection(
  api: PierFileTreeApi | null | undefined,
  path: string,
  options?: {
    /**
     * Group roots start collapsed; expand so children are visible.
     * File rows leave this unset.
     */
    readonly expandTarget?: boolean;
    /**
     * Keep DOM focus where it is. Default focuses the row so the tree can
     * paint a focus ring; tab/search callers must pass true or the next
     * key lands on the tree.
     */
    readonly preserveFocus?: boolean;
  }
): void {
  if (!(api && path.length > 0)) {
    return;
  }
  queueMicrotask(() => {
    api.revealPath(path, {
      expandTarget: options?.expandTarget === true,
      intent: "explicit",
      ...(options?.preserveFocus === undefined
        ? {}
        : { preserveFocus: options.preserveFocus }),
    });
  });
}
