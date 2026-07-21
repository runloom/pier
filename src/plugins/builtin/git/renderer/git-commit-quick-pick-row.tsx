import type { GitCommit } from "@shared/contracts/git.ts";
import { GitCommitHorizontal } from "lucide-react";
import { formatRelativeTime } from "./format-relative-time.ts";

const SHORT_HASH_LENGTH = 7;

export function shortCommitHash(hash: string): string {
  return hash.slice(0, SHORT_HASH_LENGTH);
}

export function GitCommitQuickPickRow({ commit }: { commit: GitCommit }) {
  const relativeTime = formatRelativeTime(commit.date);
  return (
    <span
      className="flex min-w-0 flex-1 items-center gap-2.5 py-0.5"
      data-commit-picker-row
    >
      <GitCommitHorizontal
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className="min-w-0 truncate font-medium text-sm/tight"
          data-commit-picker-row-subject
        >
          {commit.message}
        </span>
        <span
          className="flex min-w-0 items-baseline gap-1.5 text-muted-foreground text-xs/tight"
          data-commit-picker-row-meta
        >
          <span
            className="shrink-0 font-mono tabular-nums"
            data-commit-picker-row-hash
          >
            {shortCommitHash(commit.hash)}
          </span>
          {commit.author ? (
            <span className="min-w-0 truncate" data-commit-picker-row-author>
              · {commit.author}
            </span>
          ) : null}
        </span>
      </span>
      {relativeTime ? (
        <span
          className="shrink-0 whitespace-nowrap text-muted-foreground text-xs/tight tabular-nums"
          data-commit-picker-row-time
        >
          {relativeTime}
        </span>
      ) : null}
    </span>
  );
}
