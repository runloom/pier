import {
  kindFromJiraCategory,
  type TaskColumnKind,
} from "../../shared/columns.ts";
import { COLUMN_CAP, SCHEMA_VERSION } from "../../shared/constants.ts";
import type {
  TaskBoardParams,
  TaskBoardSnapshot,
  TaskCard,
  TaskColumn,
} from "../../shared/types.ts";

export interface JiraStatusLane {
  category?: string;
  id: string;
  name: string;
}

export function collectJiraLanes(
  catalog: ReadonlyArray<{ statuses?: readonly JiraStatusLane[] }>,
  issueStatuses: readonly JiraStatusLane[]
): JiraStatusLane[] {
  const unique = new Map<string, JiraStatusLane>();
  const groups = Array.isArray(catalog) ? catalog : [];
  for (const group of groups) {
    for (const status of group.statuses ?? []) {
      if (status.id && !unique.has(status.id)) {
        unique.set(status.id, status);
      }
    }
  }
  for (const status of issueStatuses) {
    if (status.id && !unique.has(status.id)) {
      unique.set(status.id, status);
    }
  }
  return [...unique.values()];
}

export function shapeJiraBoard(
  params: TaskBoardParams,
  lanes: readonly JiraStatusLane[],
  cards: ReadonlyArray<{ card: TaskCard; statusId: string }>,
  persistRank = true
): Omit<TaskBoardSnapshot, "generation"> {
  const unique = new Map<string, JiraStatusLane>();
  for (const lane of lanes) {
    if (!unique.has(lane.id)) {
      unique.set(lane.id, lane);
    }
  }
  const grouped = new Map<string, TaskCard[]>();
  for (const lane of unique.values()) {
    grouped.set(lane.id, []);
  }
  for (const { card, statusId } of cards) {
    const bucket = grouped.get(statusId);
    if (bucket) {
      bucket.push(card);
      continue;
    }
    unique.set(statusId, { id: statusId, name: statusId });
    grouped.set(statusId, [card]);
  }
  let truncated = false;
  const columns: TaskColumn[] = [...unique.values()].map((lane) => {
    const kind: TaskColumnKind = kindFromJiraCategory(lane.category);
    const items = grouped.get(lane.id) ?? [];
    if (items.length > COLUMN_CAP) {
      truncated = true;
    }
    return {
      id: lane.id,
      items: items.slice(0, COLUMN_CAP),
      kind,
      readonly: false,
      title: lane.name,
    };
  });
  return {
    canWrite: true,
    capabilities: {
      columnSource: "status",
      createIssue: true,
      dependencies: "native",
      persistRank,
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
