/**
 * Tab 标题旁的结构化 trailing（与 title 字符串分离）。
 * git-line-delta：色 token / Unicode − 与 GitChangeSummaryInline 对齐；
 * 零侧省略（tab 密度），与 header 内联摘要「两侧都画」不必逐字同构。
 */

import { cn } from "@pier/ui/utils.ts";
import type { PanelTabTrailing } from "@shared/contracts/panel.ts";
import type { ReactNode } from "react";

/** Unicode minus (U+2212)，与 change-summary-display 一致。 */
const LINE_DELETION_SIGN = "\u2212";

export function panelTabTrailingVisible(
  trailing: PanelTabTrailing | undefined
): boolean {
  if (!trailing) {
    return false;
  }
  if (trailing.kind === "git-line-delta") {
    return trailing.insertions > 0 || trailing.deletions > 0;
  }
  return trailing.label.length > 0;
}

export function panelTabTrailingAriaSuffix(
  trailing: PanelTabTrailing | undefined
): string | undefined {
  if (!(panelTabTrailingVisible(trailing) && trailing)) {
    return;
  }
  if (trailing.kind === "git-line-delta") {
    const parts: string[] = [];
    if (trailing.insertions > 0) {
      parts.push(`+${trailing.insertions}`);
    }
    if (trailing.deletions > 0) {
      parts.push(`${LINE_DELETION_SIGN}${trailing.deletions}`);
    }
    return parts.length > 0 ? parts.join(" ") : undefined;
  }
  return trailing.label;
}

export function PanelTabTrailingView({
  className,
  trailing,
}: {
  readonly className?: string;
  readonly trailing: PanelTabTrailing | undefined;
}): ReactNode {
  if (!(panelTabTrailingVisible(trailing) && trailing)) {
    return null;
  }

  if (trailing.kind === "git-line-delta") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center gap-0.5 font-normal text-[11px] tabular-nums",
          className
        )}
        data-pier-tab-trailing="git-line-delta"
      >
        {trailing.insertions > 0 ? (
          <span className="text-success" data-git-delta="insertions">
            +{trailing.insertions}
          </span>
        ) : null}
        {trailing.deletions > 0 ? (
          <span className="text-status-danger-fg" data-git-delta="deletions">
            {LINE_DELETION_SIGN}
            {trailing.deletions}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center text-[11px] text-muted-foreground tabular-nums",
        className
      )}
      data-pier-tab-trailing="text"
    >
      {trailing.label}
    </span>
  );
}
