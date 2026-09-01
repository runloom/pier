import {
  columnIsReadonly,
  type HeuristicColumnId,
  heuristicColumnId,
  TASK_COLUMN_IDS,
} from "../../shared/columns.ts";
import { COLUMN_CAP, SCHEMA_VERSION } from "../../shared/constants.ts";
import { formatIssueKey } from "../../shared/rpc.ts";
import type {
  LinkedPullRequest,
  TaskBlocker,
  TaskBoardParams,
  TaskBoardSnapshot,
  TaskCard,
  TaskColumn,
} from "../../shared/types.ts";

export interface GraphqlIssue {
  assignees?: { nodes?: Array<{ avatarUrl?: string; login: string }> };
  blockedBy?: {
    nodes?: Array<{
      closed?: boolean;
      number?: number;
      repository?: { nameWithOwner?: string };
      title?: string;
      url?: string;
    }>;
  };
  closed?: boolean;
  closedByPullRequestsReferences?: {
    nodes?: Array<{
      merged?: boolean;
      number?: number;
      state?: string;
      title?: string;
      url?: string;
    }>;
  };
  labels?: { nodes?: Array<{ color?: string; name: string }> };
  milestone?: { title?: string } | null;
  number: number;
  repository?: {
    nameWithOwner?: string;
    viewerPermission?: string;
  };
  state?: string;
  title: string;
  url: string;
}

const WRITE_PERMISSIONS = new Set(["WRITE", "MAINTAIN", "ADMIN"]);

export function viewerCanWrite(
  permission: string | undefined,
  fallback = true
): boolean {
  if (!permission) {
    return fallback;
  }
  return WRITE_PERMISSIONS.has(permission.toUpperCase());
}

export function blockedByFromLabels(
  labels: readonly { name: string }[] | undefined,
  repo: string
): TaskBlocker[] {
  const result: TaskBlocker[] = [];
  for (const label of labels ?? []) {
    const match =
      /^(?:blocked-by|blocked_by)[:\s]+(?:([^#\s]+\/[^#\s]+)#|#)?(\d+)$/i.exec(
        label.name.trim()
      );
    if (!match) {
      continue;
    }
    const blockerRepo = match[1] ?? repo;
    const number = Number(match[2]);
    const [owner, name] = blockerRepo.split("/");
    result.push({
      key: formatIssueKey(owner ?? "", name ?? "", number),
      repo: blockerRepo,
      title: `${blockerRepo}#${number}`,
      url: "",
    });
  }
  return result;
}

export function projectStatusColumnId(
  status: string | undefined
): HeuristicColumnId | null {
  if (!status) {
    return null;
  }
  const normalized = status.trim().toLowerCase();
  if (
    normalized === "done" ||
    normalized === "complete" ||
    normalized === "completed" ||
    normalized === "closed" ||
    normalized === "shipped"
  ) {
    return "done";
  }
  if (
    normalized === "in progress" ||
    normalized === "in-progress" ||
    normalized === "started" ||
    normalized === "doing" ||
    normalized === "in review"
  ) {
    return "inProgress";
  }
  if (
    normalized === "todo" ||
    normalized === "to do" ||
    normalized === "backlog" ||
    normalized === "ready" ||
    normalized === "new" ||
    normalized === "triage"
  ) {
    return "todo";
  }
  return null;
}

export function mapIssue(issue: GraphqlIssue, fallbackRepo: string): TaskCard {
  const repo = issue.repository?.nameWithOwner ?? fallbackRepo;
  const [owner, name] = repo.split("/");
  const assignee = issue.assignees?.nodes?.find((node) => node.login) ?? null;
  const nativeBlockers = (issue.blockedBy?.nodes ?? [])
    .filter((node) => node.number && node.repository?.nameWithOwner)
    .map((node) => {
      const blockerRepo = node.repository?.nameWithOwner ?? repo;
      const [blockerOwner, blockerName] = blockerRepo.split("/");
      return {
        closed: node.closed === true,
        key: formatIssueKey(
          blockerOwner ?? "",
          blockerName ?? "",
          node.number ?? 0
        ),
        repo: blockerRepo,
        title: node.title ?? `#${node.number}`,
        url: node.url ?? "",
      };
    });
  const openNative: TaskBlocker[] = nativeBlockers
    .filter((blocker) => !blocker.closed)
    .map(({ key, repo: blockerRepo, title, url }) => ({
      key,
      repo: blockerRepo,
      title,
      url,
    }));
  const openBlockers =
    openNative.length > 0
      ? openNative
      : blockedByFromLabels(issue.labels?.nodes, repo);
  const externalBlockers = openBlockers.filter(
    (blocker) => blocker.repo !== repo
  );
  const linkedPRs: LinkedPullRequest[] = (
    issue.closedByPullRequestsReferences?.nodes ?? []
  )
    .filter((node) => node.number && node.url)
    .map((node) => {
      const merged = node.merged === true || node.state === "MERGED";
      let state: LinkedPullRequest["state"] = "open";
      if (merged) {
        state = "merged";
      } else if (node.state === "CLOSED") {
        state = "closed";
      }
      return {
        merged,
        number: node.number ?? 0,
        state,
        title: node.title ?? `#${node.number}`,
        url: node.url ?? "",
      } satisfies LinkedPullRequest;
    });
  return {
    assignee: assignee
      ? { avatarUrl: assignee.avatarUrl, login: assignee.login }
      : null,
    blockers: openBlockers,
    externalBlockedByCount: externalBlockers.length,
    externalBlockers,
    key: formatIssueKey(owner ?? "", name ?? "", issue.number),
    labels: (issue.labels?.nodes ?? []).map((label) => ({
      color: label.color,
      name: label.name,
    })),
    linkedPRs,
    milestone: issue.milestone?.title ?? null,
    number: issue.number,
    openBlockedByCount: openBlockers.length,
    repo,
    title: issue.title,
    url: issue.url,
  };
}

export function shapeBoard(
  params: TaskBoardParams,
  issues: GraphqlIssue[],
  canWrite: boolean,
  options?: {
    columnByKey?: ReadonlyMap<string, HeuristicColumnId>;
    dependencySource?: "label" | "native" | "none";
  }
): Omit<TaskBoardSnapshot, "generation"> {
  const cards = issues.map((issue) => mapIssue(issue, params.repo));
  const grouped: Record<HeuristicColumnId, TaskCard[]> = {
    done: [],
    inProgress: [],
    todo: [],
  };
  const columnByKey = options?.columnByKey;
  const usedProject = Boolean(columnByKey && columnByKey.size > 0);
  issues.forEach((issue, index) => {
    const card = cards[index];
    if (!card) {
      return;
    }
    const mapped = columnByKey?.get(card.key);
    const columnId =
      mapped ??
      heuristicColumnId({
        assigneeLogin: card.assignee?.login,
        closed: issue.closed === true || issue.state === "CLOSED",
      });
    grouped[columnId].push(card);
  });
  let truncated = false;
  const columns: TaskColumn[] = TASK_COLUMN_IDS.map((id) => {
    const items = grouped[id];
    if (items.length > COLUMN_CAP) {
      truncated = true;
    }
    return {
      id,
      items: items.slice(0, COLUMN_CAP),
      kind: id,
      readonly: columnIsReadonly(id),
      title: columnTitle(id),
    };
  });
  const { cycleKeys, hasCycle } = detectCycles(cards);
  return {
    canWrite,
    capabilities: {
      columnSource: usedProject ? "project" : "assignment",
      createIssue: true,
      dependencies: options?.dependencySource ?? "native",
      persistRank: false,
    },
    columnMapping: usedProject || params.projectId ? "project" : "heuristic",
    columns,
    cycleKeys,
    fetchedAt: Date.now(),
    hasCycle,
    params,
    schemaVersion: SCHEMA_VERSION,
    truncated,
  };
}

export function detectCycles(cards: readonly TaskCard[]): {
  cycleKeys: string[];
  hasCycle: boolean;
} {
  const edges = new Map<string, string[]>();
  for (const card of cards) {
    edges.set(
      card.key,
      card.blockers.map((blocker) => blocker.key)
    );
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycleKeys = new Set<string>();
  const visit = (key: string): boolean => {
    if (visiting.has(key)) {
      cycleKeys.add(key);
      return true;
    }
    if (visited.has(key)) {
      return false;
    }
    visiting.add(key);
    for (const next of edges.get(key) ?? []) {
      if (visit(next)) {
        cycleKeys.add(key);
      }
    }
    visiting.delete(key);
    visited.add(key);
    return cycleKeys.has(key);
  };
  for (const card of cards) {
    visit(card.key);
  }
  return { cycleKeys: [...cycleKeys], hasCycle: cycleKeys.size > 0 };
}

const COLUMN_TITLES: Record<HeuristicColumnId, string> = {
  done: "Done",
  inProgress: "In Progress",
  todo: "Todo",
};

function columnTitle(id: HeuristicColumnId): string {
  return COLUMN_TITLES[id];
}
