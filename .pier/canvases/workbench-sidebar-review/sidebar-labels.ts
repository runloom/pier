import { COPY, type Locale } from "./copy.ts";
import type { ActivityStatus, Project, Session, Worktree } from "./data.ts";

export function joinLabel(
  parts: Array<string | false | null | undefined>
): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

export function fileCount(tree: Worktree, locale: Locale) {
  const n = tree.summary?.changedFiles ?? 0;
  return COPY[locale].filesCount.replace("{{count}}", String(n));
}

export function summaryText(tree: Worktree, locale: Locale) {
  const summary = tree.summary;
  if (!summary) {
    return "";
  }
  const count = fileCount(tree, locale);
  return summary.kind === "lineDelta"
    ? `${count} · +${summary.insertions} −${summary.deletions}`
    : `${count} · ${COPY[locale].linesUnavailable}`;
}

export function projectControlLabel(
  project: Project,
  locale: Locale,
  status: ActivityStatus
): string {
  const c = COPY[locale];
  return joinLabel([project.name, c[status]]);
}

export function treeControlLabel(
  tree: Worktree,
  locale: Locale,
  unread: boolean
): string {
  const c = COPY[locale];
  return joinLabel([
    tree.name,
    tree.path,
    tree.branch ? `${c.branch} ${tree.branch}` : "",
    tree.isMain ? c.mainDirectory : "",
    c[tree.status],
    unread ? c.unread : "",
    tree.summary ? summaryText(tree, locale) : "",
  ]);
}

export function sessionControlLabel(
  session: Session,
  treeName: string,
  locale: Locale,
  unread: boolean,
  here: boolean,
  away: boolean
): string {
  const c = COPY[locale];
  return joinLabel([
    treeName,
    session.title,
    here ? c.currentHere : "",
    away ? c.otherWindow : "",
    c[session.status],
    unread ? c.unread : "",
    session.windowLabel,
  ]);
}
