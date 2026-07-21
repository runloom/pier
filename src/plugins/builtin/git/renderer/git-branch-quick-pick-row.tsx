import { Badge } from "@pier/ui/badge.tsx";
import type { GitDiffBranchOption } from "@shared/contracts/git.ts";
import { CircleAlert, GitBranch, GitBranchPlus } from "lucide-react";
import { formatRelativeTime } from "./format-relative-time.ts";

interface GitBranchQuickPickRowProps {
  branch: GitDiffBranchOption;
  defaultLabel: string;
  graphCaveatTitle: string;
  graphLabel: string;
  remoteLabel: string;
}

export function GitBranchQuickPickRow({
  branch,
  defaultLabel,
  graphCaveatTitle,
  graphLabel,
  remoteLabel,
}: GitBranchQuickPickRowProps) {
  const relativeTime = formatRelativeTime(branch.committerDate);
  const hasMeta = Boolean(branch.authorName || branch.commit || branch.subject);
  const aheadBehind = branchAheadBehind(branch);

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
          {branch.pinReason ? (
            <Badge
              data-branch-picker-row-pin
              data-pin-reason={branch.pinReason}
              size="xs"
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
                data-branch-picker-row-remote
                size="xs"
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
