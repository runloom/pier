import { Badge } from "@pier/ui/badge.tsx";
import type {
  GitBranchTipTreeInCurrentHistory,
  GitDiffBranchOption,
} from "@shared/contracts/git.ts";
import { CircleAlert, GitBranch, GitBranchPlus } from "lucide-react";
import { formatRelativeTime } from "./format-relative-time.ts";

/** Badge 默认尺寸偏大,统一压缩到行内 4px 网格;色彩语义交给 variant。 */
const ROW_BADGE_CLASS = "h-4 rounded-sm px-1.5 text-[10px]";

interface GitBranchQuickPickRowProps {
  branch: GitDiffBranchOption;
  defaultLabel: string;
  graphCaveatTitle: string;
  graphLabel: string;
  remoteLabel: string;
  tipTreeInHistoryLabel: string;
  tipTreeInHistoryTitle: (match: GitBranchTipTreeInCurrentHistory) => string;
}

export function GitBranchQuickPickRow({
  branch,
  defaultLabel,
  graphCaveatTitle,
  graphLabel,
  remoteLabel,
  tipTreeInHistoryLabel,
  tipTreeInHistoryTitle,
}: GitBranchQuickPickRowProps) {
  const relativeTime = formatRelativeTime(branch.committerDate);
  const hasMeta = Boolean(branch.authorName || branch.commit || branch.subject);
  const aheadBehind = branchAheadBehind(branch);
  const tipTreeInHistory = branch.tipTreeInCurrentHistory;

  return (
    <span
      className="flex min-w-0 flex-1 items-center gap-2.5 py-0.5"
      data-branch-kind={branch.kind}
      data-branch-picker-row
    >
      <GitBranch
        aria-hidden="true"
        className={
          branch.kind === "remote"
            ? "size-4 shrink-0 text-muted-foreground"
            : "size-4 shrink-0 text-foreground"
        }
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className="flex min-w-0 items-baseline gap-1.5"
          data-branch-picker-row-title
        >
          <span
            className="min-w-0 truncate font-medium text-sm/tight"
            data-branch-picker-row-name
          >
            {branch.name}
          </span>
          {aheadBehind ? (
            <span
              className="inline-flex shrink-0 items-baseline gap-1 text-[10px] tabular-nums"
              data-branch-picker-row-ahead-behind
              title={graphCaveatTitle}
            >
              <span
                className="text-muted-foreground"
                data-branch-picker-row-graph-label
              >
                {graphLabel}
              </span>
              <span
                className={
                  aheadBehind.behind > 0
                    ? "text-warning"
                    : "text-muted-foreground/50"
                }
                data-branch-picker-row-behind
              >
                {aheadBehind.behind}↓
              </span>
              <span
                className={
                  aheadBehind.ahead > 0
                    ? "text-success"
                    : "text-muted-foreground/50"
                }
                data-branch-picker-row-ahead
              >
                {aheadBehind.ahead}↑
              </span>
            </span>
          ) : null}
          {tipTreeInHistory ? (
            <Badge
              className={ROW_BADGE_CLASS}
              data-branch-picker-row-tip-tree-in-history
              title={tipTreeInHistoryTitle(tipTreeInHistory)}
              variant="secondary"
            >
              {tipTreeInHistoryLabel}
            </Badge>
          ) : null}
          {branch.pinReason ? (
            <Badge
              className={ROW_BADGE_CLASS}
              data-branch-picker-row-pin
              data-pin-reason={branch.pinReason}
            >
              {defaultLabel}
            </Badge>
          ) : null}
        </span>
        {hasMeta ? (
          <span
            className="flex min-w-0 items-baseline gap-1.5 text-muted-foreground text-xs/tight"
            data-branch-picker-row-meta
          >
            {branch.kind === "remote" ? (
              <Badge
                className={ROW_BADGE_CLASS}
                data-branch-picker-row-remote
                variant="secondary"
              >
                {remoteLabel}
              </Badge>
            ) : null}
            {branch.authorName ? (
              <span className="shrink-0 truncate" data-branch-picker-row-author>
                {branch.authorName}
              </span>
            ) : null}
            {branch.commit ? (
              <span
                className="shrink-0 font-mono tabular-nums"
                data-branch-picker-row-hash
              >
                {branch.commit}
              </span>
            ) : null}
            {branch.subject ? (
              <span className="min-w-0 truncate" data-branch-picker-row-subject>
                · {branch.subject}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      {relativeTime ? (
        <span
          className="shrink-0 whitespace-nowrap text-muted-foreground text-xs/tight tabular-nums"
          data-branch-picker-row-time
        >
          {relativeTime}
        </span>
      ) : null}
    </span>
  );
}

export function GitBranchQueryQuickPickRow({
  detail,
  kind,
  label,
}: {
  detail?: string;
  kind: "create" | "current" | "existing" | "invalid";
  label: string;
}) {
  let Icon = GitBranch;
  if (kind === "create") {
    Icon = GitBranchPlus;
  } else if (kind === "invalid") {
    Icon = CircleAlert;
  }
  return (
    <span
      className="flex min-w-0 flex-1 items-center gap-2.5 py-0.5"
      data-branch-query-kind={kind}
      data-branch-query-picker-row
    >
      <Icon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium text-sm/tight">{label}</span>
        {detail ? (
          <span className="truncate text-muted-foreground text-xs/tight">
            {detail}
          </span>
        ) : null}
      </span>
    </span>
  );
}

function branchAheadBehind(
  branch: GitDiffBranchOption
): null | { ahead: number; behind: number } {
  const { aheadFromCurrent, behindFromCurrent } = branch;
  if (aheadFromCurrent == null && behindFromCurrent == null) {
    return null;
  }
  return {
    ahead: aheadFromCurrent ?? 0,
    behind: behindFromCurrent ?? 0,
  };
}
