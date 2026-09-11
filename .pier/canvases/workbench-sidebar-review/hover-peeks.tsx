import { HoverCard, HoverCardContent, HoverCardTrigger } from "pier/canvas";
import type { ReactNode } from "react";
import { COPY, type Locale } from "./copy.ts";
import {
  DEMO_LOCAL_DIRECTORIES,
  DEMO_PROJECTS,
  DEMO_REMOTE_HOST,
  DEMO_REMOTE_PROJECTS,
  type Worktree,
} from "./data.ts";
import { fileCount, joinLabel, summaryText } from "./sidebar-labels.ts";

const LINE_DELETION_SIGN = "\u2212";

function GitLineDelta({
  deletions,
  insertions,
}: {
  deletions: number;
  insertions: number;
}) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs tabular-nums">
      <span className="text-success">+{insertions}</span>
      <span className="text-status-danger-fg">
        {LINE_DELETION_SIGN}
        {deletions}
      </span>
    </span>
  );
}

function treeUnread(tree: Worktree): boolean {
  return tree.sessions.some((session) => session.unread);
}

function treeKind(tree: Worktree): "git" | "local" | "remote" {
  if (tree.project === "local-directories") {
    return "local";
  }
  if (tree.key.startsWith("demo:ssh:")) {
    return "remote";
  }
  return "git";
}

export function WorktreePeek({
  locale,
  tree,
}: {
  locale: Locale;
  tree: Worktree;
}) {
  const c = COPY[locale];
  const kind = treeKind(tree);
  return (
    <div className="flex flex-col gap-1.5">
      {kind === "remote" ? (
        <p className="text-muted-foreground text-xs leading-snug">
          {c.sshHost.replace("{{host}}", DEMO_REMOTE_HOST)}
        </p>
      ) : null}
      {kind === "local" ? (
        <p className="text-muted-foreground text-xs leading-snug">
          {c.localDirectories}
        </p>
      ) : null}
      <p className="break-all text-muted-foreground text-xs leading-snug">
        {tree.path}
      </p>
      {tree.branch ? (
        <p className="text-muted-foreground text-xs leading-snug">
          {joinLabel([c.branch, tree.branch])}
        </p>
      ) : null}
      {tree.summary?.kind === "lineDelta" ? (
        <p className="flex flex-wrap items-center gap-1 text-xs leading-snug">
          <GitLineDelta
            deletions={tree.summary.deletions}
            insertions={tree.summary.insertions}
          />
          <span className="text-muted-foreground">
            {fileCount(tree, locale)}
          </span>
        </p>
      ) : tree.summary ? (
        <p className="text-muted-foreground text-xs leading-snug">
          {summaryText(tree, locale)}
        </p>
      ) : null}
    </div>
  );
}

export function PeekSpecimen({
  caption,
  children,
}: {
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className="w-64" style={{ minHeight: 128 }}>
      <HoverCard closeDelay={0} open openDelay={0}>
        <HoverCardTrigger asChild>
          <p className="mb-2 cursor-default text-muted-foreground text-xs leading-snug">
            {caption}
          </p>
        </HoverCardTrigger>
        <HoverCardContent
          align="start"
          avoidCollisions={false}
          className="w-64 p-3"
          side="bottom"
          sideOffset={4}
        >
          {children}
        </HoverCardContent>
      </HoverCard>
    </div>
  );
}

export const WORKTREE_PEEK_SAMPLES: Worktree[] = [
  DEMO_PROJECTS[0]!.worktrees[0]!,
  DEMO_PROJECTS[0]!.worktrees[1]!,
  DEMO_PROJECTS[0]!.worktrees[2]!,
  DEMO_PROJECTS[1]!.worktrees[0]!,
  DEMO_PROJECTS[1]!.worktrees[1]!,
  DEMO_LOCAL_DIRECTORIES[0]!,
  DEMO_REMOTE_PROJECTS[0]!.worktrees[0]!,
];

export function worktreePeekCaption(tree: Worktree, locale: Locale): string {
  const c = COPY[locale];
  const kind = treeKind(tree);
  return joinLabel([
    tree.name,
    kind === "remote" ? c.remoteScenario : "",
    kind === "local" ? c.localDirectories : "",
    tree.isMain ? c.mainDirectory : "",
    tree.branch ?? "",
    c[tree.status],
    treeUnread(tree) ? c.unread : "",
    tree.summary
      ? tree.summary.kind === "lineDelta"
        ? c.peekGitDelta
        : c.peekGitFiles
      : "",
  ]);
}
