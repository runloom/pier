import type { PierFileTreeApi } from "@pier/ui/file/tree.tsx";

/**
 * Explicit tree orient: select the row and scroll it into the optimal viewport.
 * Does not open files; selection/open stays with the caller.
 *
 * Not continuous active-file tracking. Defer past the click frame so
 * expansion/selection settle first.
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
  const run = () => {
    api.revealPath(path, {
      expandTarget: options?.expandTarget === true,
      intent: "explicit",
      ...(options?.preserveFocus === undefined
        ? {}
        : { preserveFocus: options.preserveFocus }),
    });
  };
  queueMicrotask(run);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
  }
}
