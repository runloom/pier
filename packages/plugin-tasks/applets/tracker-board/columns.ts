export type TaskColumnKind = "canceled" | "done" | "inProgress" | "todo";

export function isHeuristicLaneSet(
  columns: readonly { id: string }[]
): boolean {
  return (
    columns.length === 3 &&
    columns[0]?.id === "todo" &&
    columns[1]?.id === "inProgress" &&
    columns[2]?.id === "done"
  );
}

export function columnKindOf(column: {
  id: string;
  kind?: string | undefined;
}): TaskColumnKind {
  if (
    column.kind === "canceled" ||
    column.kind === "done" ||
    column.kind === "inProgress" ||
    column.kind === "todo"
  ) {
    return column.kind;
  }
  if (column.id === "done" || column.id === "inProgress") {
    return column.id;
  }
  return "todo";
}

export function isTodoColumn(column: {
  id: string;
  kind?: string | undefined;
}): boolean {
  return columnKindOf(column) === "todo";
}

export function isDoneColumn(column: {
  id: string;
  kind?: string | undefined;
}): boolean {
  return columnKindOf(column) === "done";
}

export function isTerminalColumn(column: {
  id: string;
  kind?: string | undefined;
}): boolean {
  const kind = columnKindOf(column);
  return kind === "done" || kind === "canceled";
}

export function firstColumnIdOfKind(
  columns: readonly { id: string; kind?: string | undefined }[],
  kind: TaskColumnKind
): string | undefined {
  return columns.find((column) => columnKindOf(column) === kind)?.id;
}
