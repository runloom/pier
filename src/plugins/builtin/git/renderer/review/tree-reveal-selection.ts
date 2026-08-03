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
  path: string,
  options?: {
    /**
     * 搜索栏仍开着时必须传 true：reveal 会跨 microtask 和两帧反复把 DOM 焦点
     * 抢到行按钮上（为了画焦点环），用户在 Enter 之后紧接着按 Esc / Enter 会
     * 落到树上而不是搜索框。
     */
    readonly preserveFocus?: boolean;
  }
): void {
  if (!(api && path.length > 0)) {
    return;
  }
  const run = () => {
    api.revealPath(path, {
      expandTarget: false,
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
