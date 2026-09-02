import { isHeuristicLaneSet } from "./columns.ts";

export function boardSnapshotMatches(
  value: unknown,
  params: {
    projectId?: string;
    provider?: string;
    repo: string;
  }
): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as {
    columns?: unknown;
    fetchedAt?: unknown;
    params?: { projectId?: string; provider?: string; repo?: string };
  };
  if (!Array.isArray(record.columns) || typeof record.fetchedAt !== "number") {
    return false;
  }
  if (record.fetchedAt === 0) {
    return false;
  }
  if (
    (params.provider === "linear" || params.provider === "jira") &&
    isHeuristicLaneSet(record.columns as Array<{ id: string }>)
  ) {
    return false;
  }
  const snapshotParams = record.params;
  if (!snapshotParams || typeof snapshotParams.repo !== "string") {
    return true;
  }
  if (snapshotParams.repo === "-" || snapshotParams.repo !== params.repo) {
    return false;
  }
  if ((snapshotParams.projectId ?? "") !== (params.projectId ?? "")) {
    return false;
  }
  return !(
    params.provider &&
    snapshotParams.provider &&
    snapshotParams.provider !== params.provider
  );
}
