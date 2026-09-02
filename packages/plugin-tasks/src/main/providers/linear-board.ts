import {
  kindFromLinearType,
  type TaskColumnKind,
} from "../../shared/columns.ts";
import { COLUMN_CAP, SCHEMA_VERSION } from "../../shared/constants.ts";
import type {
  TaskBoardParams,
  TaskBoardSnapshot,
  TaskCard,
  TaskColumn,
} from "../../shared/types.ts";

export interface LinearWorkflowState {
  id: string;
  name: string;
  position?: number;
  type?: string;
}

export function defaultLinearStateName(type: string | undefined): string {
  if (type === "started") {
    return "In Progress";
  }
  if (type === "completed") {
    return "Done";
  }
  if (type === "canceled") {
    return "Canceled";
  }
  return "Todo";
}

export function deriveLinearStates(
  issues: ReadonlyArray<{
    state?: { id?: string; name?: string; type?: string };
  }>
): LinearWorkflowState[] {
  const seen = new Map<string, LinearWorkflowState>();
  for (const issue of issues) {
    const type = issue.state?.type;
    const id = issue.state?.id ?? `type:${type ?? "unstarted"}`;
    if (seen.has(id)) {
      continue;
    }
    seen.set(id, {
      id,
      name: issue.state?.name ?? defaultLinearStateName(type),
      position: seen.size,
      ...(type ? { type } : {}),
    });
  }
  return [...seen.values()];
}

function byRank(left: TaskCard, right: TaskCard): number {
  return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
}

export function shapeLinearBoard(
  params: TaskBoardParams,
  states: readonly LinearWorkflowState[],
  cards: ReadonlyArray<{ card: TaskCard; stateId: string }>
): Omit<TaskBoardSnapshot, "generation"> {
  const unique = new Map<string, LinearWorkflowState>();
  for (const state of states) {
    if (!unique.has(state.id)) {
      unique.set(state.id, state);
    }
  }
  const grouped = new Map<string, TaskCard[]>();
  for (const state of unique.values()) {
    grouped.set(state.id, []);
  }
  for (const { card, stateId } of cards) {
    const bucket = grouped.get(stateId);
    if (bucket) {
      bucket.push(card);
      continue;
    }
    unique.set(stateId, {
      id: stateId,
      name: defaultLinearStateName(undefined),
      position: unique.size,
    });
    grouped.set(stateId, [card]);
  }
  const ordered = [...unique.values()].sort(
    (left, right) => (left.position ?? 0) - (right.position ?? 0)
  );
  let truncated = false;
  const columns: TaskColumn[] = ordered.map((state) => {
    const kind: TaskColumnKind = kindFromLinearType(state.type);
    const items = [...(grouped.get(state.id) ?? [])].sort(byRank);
    if (items.length > COLUMN_CAP) {
      truncated = true;
    }
    return {
      id: state.id,
      items: items.slice(0, COLUMN_CAP),
      kind,
      readonly: false,
      title: state.name,
    };
  });
  return {
    canWrite: true,
    capabilities: {
      columnSource: "status",
      createIssue: true,
      dependencies: "native",
      persistRank: true,
    },
    columnMapping: "project",
    columns,
    cycleKeys: [],
    fetchedAt: Date.now(),
    hasCycle: false,
    params,
    schemaVersion: SCHEMA_VERSION,
    truncated,
  };
}
