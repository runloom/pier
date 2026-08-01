import type { PierFileTreeApi } from "@pier/ui/file/tree.tsx";

/**
 * After the user opens a change from the shared review tree, ensure that row
 * sits in the optimal viewport (center). Does not open files; selection/open
 * stays with the caller.
 *
 * Not continuous active-file tracking: only runs on explicit open intents.
 * Defer past the click frame so expansion/selection settle first.
 */
export function revealGitReviewTreeSelection(
  api: PierFileTreeApi | null | undefined,
  path: string
): void {
  if (!(api && path.length > 0)) {
    return;
  }
  const run = () => {
    api.revealPath(path, {
      expandTarget: false,
      intent: "explicit",
    });
  };
  queueMicrotask(run);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
  }
}
