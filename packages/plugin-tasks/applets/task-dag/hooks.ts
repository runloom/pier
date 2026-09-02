import { useHostSnapshot } from "pier/host";
import type { TrackerBoardProps } from "../tracker-board/hooks.ts";

export interface TaskDagNodeModel {
  key: string;
  title: string;
}

export interface TaskDagEdgeModel {
  from: string;
  to: string;
}

export interface TaskDagModel {
  cycleKeys: readonly string[];
  edges: readonly TaskDagEdgeModel[];
  fetchedAt: number;
  hasCycle: boolean;
  nodes: readonly TaskDagNodeModel[];
}

export function dagWatchTarget(props: TrackerBoardProps): string {
  const query = new URLSearchParams();
  query.set("repo", props.repo ?? "-");
  if (props.provider) {
    query.set("provider", props.provider);
  }
  if (props.milestone) {
    query.set("milestone", props.milestone);
  }
  if (props.label) {
    query.set("label", props.label);
  }
  if (props.projectId) {
    query.set("projectId", props.projectId);
  }
  return `plugin:pier.tasks/dag?${query.toString()}`;
}

function isDag(value: unknown): value is TaskDagModel {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.nodes) &&
    Array.isArray(record.edges) &&
    typeof record.fetchedAt === "number"
  );
}

/** Graph structure comes from the dag projection; interactions join board. */
export function useTaskDag(props: TrackerBoardProps): {
  dag: TaskDagModel | null;
  error: string | null;
  status: "error" | "loading" | "ready";
} {
  const snapshot = useHostSnapshot(dagWatchTarget(props));
  return {
    dag: isDag(snapshot.data) ? snapshot.data : null,
    error: snapshot.error,
    status: snapshot.status,
  };
}
