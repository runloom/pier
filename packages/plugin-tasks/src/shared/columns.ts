/** Source state id (Linear/Jira) or a GitHub heuristic lane. */
export type TaskColumnId = string;
export type TaskColumnKind = "canceled" | "done" | "inProgress" | "todo";
export type HeuristicColumnId = "todo" | "inProgress" | "done";

export const TASK_COLUMN_IDS = [
  "todo",
  "inProgress",
  "done",
] as const satisfies readonly HeuristicColumnId[];

/** Pre-workflow Linear/Jira snapshots collapsed every state into these three ids. */
export function isHeuristicLaneSet(
  columns: readonly { id: string }[]
): boolean {
  return (
    columns.length === TASK_COLUMN_IDS.length &&
    TASK_COLUMN_IDS.every((id, index) => columns[index]?.id === id)
  );
}

export function kindFromLinearType(type: string | undefined): TaskColumnKind {
  if (type === "completed") {
    return "done";
  }
  if (type === "canceled") {
    return "canceled";
  }
  if (type === "started") {
    return "inProgress";
  }
  return "todo";
}

export function kindFromJiraCategory(key: string | undefined): TaskColumnKind {
  if (key === "done") {
    return "done";
  }
  if (key === "indeterminate") {
    return "inProgress";
  }
  return "todo";
}

export function isTerminalColumnKind(
  kind: TaskColumnKind | undefined
): boolean {
  return kind === "done" || kind === "canceled";
}

export function heuristicColumnId(input: {
  assigneeLogin?: string | null | undefined;
  closed: boolean;
}): HeuristicColumnId {
  if (input.closed) {
    return "done";
  }
  if (input.assigneeLogin) {
    return "inProgress";
  }
  return "todo";
}

export function linkedPullRequestsAllowDone(
  linkedPRs: readonly { merged: boolean }[]
): boolean {
  return linkedPRs.length > 0 && linkedPRs.every((pr) => pr.merged);
}

export function columnIsReadonly(
  columnId: TaskColumnId,
  options?: {
    confirm?: boolean | undefined;
    linkedPRs?: readonly { merged: boolean }[];
  }
): boolean {
  if (columnId !== "done") {
    return false;
  }
  if (options?.confirm === true) {
    return false;
  }
  if (options?.linkedPRs && linkedPullRequestsAllowDone(options.linkedPRs)) {
    return false;
  }
  return true;
}
