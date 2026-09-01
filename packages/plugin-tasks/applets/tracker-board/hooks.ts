import { host, useHostSnapshot } from "pier/host";
import { localeFromNavigator, translate } from "../copy/index.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TaskColumnKind } from "./columns.ts";
import { boardSnapshotMatches } from "./match.ts";
import { placeCardInColumn } from "./sort-order.ts";

export { boardSnapshotMatches } from "./match.ts";

export const OPTIMISTIC_GRACE_MS = 6000;

export type { TaskColumnKind } from "./columns.ts";
export type TaskColumnId = string;

export interface TrackerBoardProps {
  /**
   * `panel` fills the project tracker tab. `island` is the markdown / canvas
   * card. `embedded: true` is the panel alias.
   */
  chrome?: "island" | "panel" | undefined;
  embedded?: boolean | undefined;
  label?: string | undefined;
  milestone?: string | undefined;
  projectId?: string | undefined;
  projectRootPath?: string | undefined;
  provider?: "github" | "jira" | "linear" | undefined;
  repo?: string | undefined;
}

export interface TaskCardModel {
  assignee: { avatarUrl?: string | undefined; login: string } | null;
  blockers?: readonly { key: string; repo?: string; title?: string; url?: string }[];
  key: string;
  labels?: readonly { color?: string | undefined; name: string }[];
  linkedPRs: readonly { merged: boolean; number: number }[];
  milestone?: string | null;
  openBlockedByCount: number;
  sortOrder?: number;
  title: string;
  url: string;
  work?: { panelId?: string; path: string } | null;
}

export interface TaskColumnModel {
  id: TaskColumnId;
  items: readonly TaskCardModel[];
  kind?: TaskColumnKind;
  readonly: boolean;
  title: string;
}

export interface TaskBoardModel {
  canWrite: boolean;
  capabilities?: { persistRank?: boolean };
  columnMapping: "heuristic" | "project";
  columns: readonly TaskColumnModel[];
  cycleKeys?: readonly string[];
  fetchedAt: number;
  generation: number;
  hasCycle?: boolean;
  truncated?: boolean;
}

export type CardActivityStatus = "error" | "processing" | "waiting" | null;

export function boardWatchTarget(props: TrackerBoardProps): string {
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
  return `plugin:pier.tasks/board?${query.toString()}`;
}

export function linkedPullRequestsAllowDone(
  linkedPRs: readonly { merged: boolean }[]
): boolean {
  return linkedPRs.length > 0 && linkedPRs.every((pr) => pr.merged);
}

function isBoard(value: unknown): value is TaskBoardModel {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.columns) && typeof record.fetchedAt === "number";
}

export function boardColumnsAlign(
  left: TaskBoardModel,
  right: TaskBoardModel
): boolean {
  if (left.columns.length !== right.columns.length) {
    return false;
  }
  for (let index = 0; index < left.columns.length; index += 1) {
    const a = left.columns[index]?.items.map((item) => item.key) ?? [];
    const b = right.columns[index]?.items.map((item) => item.key) ?? [];
    if (a.length !== b.length) {
      return false;
    }
    for (let itemIndex = 0; itemIndex < a.length; itemIndex += 1) {
      if (a[itemIndex] !== b[itemIndex]) {
        return false;
      }
    }
  }
  return true;
}

/** Keep the optimistic board until the tracker snapshot shows the same columns. */
export function resolveBoardView(input: {
  now?: number;
  optimistic: TaskBoardModel | null;
  pendingUntil: number;
  remote: TaskBoardModel | null;
}): TaskBoardModel | null {
  if (!input.optimistic || (input.now ?? Date.now()) >= input.pendingUntil) {
    return input.remote;
  }
  if (input.remote && boardColumnsAlign(input.optimistic, input.remote)) {
    return input.remote;
  }
  return input.optimistic;
}

function activityStatusMap(value: unknown): Map<string, CardActivityStatus> {
  const result = new Map<string, CardActivityStatus>();
  if (!value || typeof value !== "object" || !("activities" in value)) {
    return result;
  }
  const activities = (value as { activities: unknown }).activities;
  if (!Array.isArray(activities)) {
    return result;
  }
  for (const activity of activities) {
    if (!activity || typeof activity !== "object") {
      continue;
    }
    const record = activity as Record<string, unknown>;
    if (typeof record.panelId !== "string") {
      continue;
    }
    const status = record.status;
    if (status === "waiting" || status === "error" || status === "processing") {
      result.set(record.panelId, status);
    } else if (status === "tool") {
      result.set(record.panelId, "processing");
    }
  }
  return result;
}

const AUTO_REFRESH_MIN_GAP_MS = 10_000;
const AUTO_REFRESH_SETTLE_MS = 1500;

function explicitParams(props: TrackerBoardProps): {
  provider?: TrackerBoardProps["provider"];
  repo: string;
} | null {
  if (!props.repo) {
    return null;
  }
  return {
    repo: props.repo,
    ...(props.provider ? { provider: props.provider } : {}),
  };
}

export function useTrackerBoard(props: TrackerBoardProps) {
  const [fallback, setFallback] = useState<{
    provider?: TrackerBoardProps["provider"];
    repo: string;
  } | null>(null);
  useEffect(() => {
    if (props.repo) {
      setFallback(null);
      return;
    }
    let cancelled = false;
    host
      .invoke({
        payload: {
          key: "source.resolve",
          payload: props.projectRootPath
            ? { projectRootPath: props.projectRootPath }
            : {},
          pluginId: "pier.tasks",
        },
        type: "pluginAction.invoke",
      })
      .then((value) => {
        if (cancelled || !value || typeof value !== "object") {
          return;
        }
        const record = value as { params?: { provider?: string; repo?: string } };
        const repo = record.params?.repo;
        if (typeof repo !== "string" || repo.length === 0) {
          return;
        }
        const provider = record.params?.provider;
        setFallback({
          repo,
          ...(provider === "github" ||
          provider === "linear" ||
          provider === "jira"
            ? { provider }
            : {}),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [props.projectRootPath, props.repo]);
  const resolved = explicitParams(props) ?? fallback;
  const target = boardWatchTarget({
    ...props,
    ...(resolved ?? { repo: "-" }),
  });
  const snapshot = useHostSnapshot(target);
  const activitySnapshot = useHostSnapshot("foreground-activity");
  const [optimistic, setOptimistic] = useState<TaskBoardModel | null>(null);
  const pendingUntil = useRef(0);

  const remote = boardSnapshotMatches(snapshot.data, {
    repo: resolved?.repo ?? "-",
    ...(resolved?.provider ? { provider: resolved.provider } : {}),
    ...(props.projectId ? { projectId: props.projectId } : {}),
  })
    ? isBoard(snapshot.data)
      ? snapshot.data
      : null
    : null;
  const board = useMemo(
    () =>
      resolveBoardView({
        optimistic,
        pendingUntil: pendingUntil.current,
        remote,
      }),
    [optimistic, remote]
  );

  useEffect(() => {
    setOptimistic(null);
  }, [resolved?.provider, resolved?.repo]);

  useEffect(() => {
    if (!optimistic) {
      return;
    }
    const remaining = pendingUntil.current - Date.now();
    if (remaining <= 0) {
      setOptimistic(null);
      return;
    }
    const timer = setTimeout(() => {
      setOptimistic(null);
    }, remaining);
    return () => {
      clearTimeout(timer);
    };
  }, [optimistic]);

  const activityByPanel = useMemo(
    () => activityStatusMap(activitySnapshot.data),
    [activitySnapshot.data]
  );

  const params = {
    repo: resolved?.repo ?? "-",
    ...(resolved?.provider ? { provider: resolved.provider } : {}),
    ...(props.milestone ? { milestone: props.milestone } : {}),
    ...(props.label ? { label: props.label } : {}),
    ...(props.projectId ? { projectId: props.projectId } : {}),
  };

  const invoke = async (key: string, payload: Record<string, unknown>) => {
    return host.invoke({
      payload: { key, pluginId: "pier.tasks", payload },
      type: "pluginAction.invoke",
    });
  };

  const moveCard = async (
    itemKey: string,
    columnId: TaskColumnId,
    confirm = false,
    index?: number
  ) => {
    if (!board) {
      return;
    }
    const card = board.columns
      .flatMap((column) => column.items)
      .find((item) => item.key === itemKey);
    if (!card) {
      return;
    }
    const target = board.columns.find((column) => column.id === columnId);
    const goingDone =
      target?.kind === "done" || columnId === "done";
    if (
      board.columnMapping !== "project" &&
      goingDone &&
      !confirm &&
      !linkedPullRequestsAllowDone(card.linkedPRs)
    ) {
      throw new Error(translate(localeFromNavigator(), "view.moveFailed"));
    }
    let persistSortOrder = true;
    let rankAfterKey: string | undefined;
    let rankBeforeKey: string | undefined;
    let sortOrder: number | undefined;
    const next: TaskBoardModel = {
      ...board,
      columns: board.columns.map((column) => {
        if (column.id !== columnId) {
          return {
            ...column,
            items: column.items.filter((item) => item.key !== itemKey),
          };
        }
        const placed = placeCardInColumn(column.items, card, index);
        persistSortOrder = placed.persistSortOrder;
        rankAfterKey = placed.rankAfterKey;
        rankBeforeKey = placed.rankBeforeKey;
        sortOrder = placed.sortOrder;
        return { ...column, items: placed.items };
      }),
    };
    pendingUntil.current = Date.now() + OPTIMISTIC_GRACE_MS;
    setOptimistic(next);
    try {
      await invoke("task.setStatus", {
        columnId,
        itemKey,
        params,
        ...(confirm ? { confirm: true } : {}),
        ...(rankAfterKey ? { rankAfterKey } : {}),
        ...(rankBeforeKey ? { rankBeforeKey } : {}),
        ...(persistSortOrder && sortOrder !== undefined ? { sortOrder } : {}),
      });
    } catch {
      setOptimistic(null);
      throw new Error(translate(localeFromNavigator(), "view.moveFailed"));
    }
  };

  const refresh = async () => {
    await invoke("task.refresh", { params });
  };

  const reconnect = async () => {
    const provider = resolved?.provider ?? props.provider;
    if (provider !== "linear" && provider !== "jira") {
      return;
    }
    await invoke("connection.revokeProvider", { provider });
  };

  const openIssue = async (url: string) => {
    await host.invoke({ type: "app.openExternal", url });
  };

  const focusWork = async (panelId: string) => {
    await host.invoke({ focus: true, panelId, type: "panel.focus" });
  };

  // Opportunistic refresh: when an agent bound to a card stops processing
  // (turn finished / needs input / errored), pull the tracker once so PR and
  // status changes land without waiting for the next poll.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const processingPanels = useRef<ReadonlySet<string>>(new Set());
  const lastAutoRefresh = useRef(0);
  useEffect(() => {
    const current = new Set<string>();
    for (const [panelId, status] of activityByPanel) {
      if (status === "processing") {
        current.add(panelId);
      }
    }
    const workPanels = new Set(
      (board?.columns ?? [])
        .flatMap((column) => column.items)
        .map((item) => item.work?.panelId)
        .filter((panelId): panelId is string => Boolean(panelId))
    );
    const ended = [...processingPanels.current].some(
      (panelId) => !current.has(panelId) && workPanels.has(panelId)
    );
    processingPanels.current = current;
    if (!ended) {
      return;
    }
    const now = Date.now();
    if (now - lastAutoRefresh.current < AUTO_REFRESH_MIN_GAP_MS) {
      return;
    }
    lastAutoRefresh.current = now;
    const timer = setTimeout(() => {
      refreshRef.current().catch(() => undefined);
    }, AUTO_REFRESH_SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [activityByPanel, board]);

  const startWork = async (itemKey: string) => {
    await invoke("task.startWork", {
      itemKey,
      params,
      ...(props.projectRootPath
        ? { projectRootPath: props.projectRootPath }
        : {}),
    });
  };

  const pruneWork = async (itemKey: string) => {
    await invoke("task.pruneWorktree", { itemKey, params });
  };

  const startAllReady = async () => {
    const result = await invoke("task.startAllReady", { params });
    const keys =
      result &&
      typeof result === "object" &&
      "itemKeys" in result &&
      Array.isArray(result.itemKeys)
        ? result.itemKeys.filter((key): key is string => typeof key === "string")
        : [];
    for (const key of keys) {
      void startWork(key);
    }
  };

  return {
    activityByPanel,
    board,
    error: remote || snapshot.status !== "ready" ? snapshot.error : null,
    focusWork,
    moveCard,
    openIssue,
    params,
    pruneWork,
    reconnect,
    refresh,
    startAllReady,
    startWork,
    status:
      snapshot.status === "error" && !remote
        ? "error"
        : remote
          ? snapshot.status
          : "loading",
  };
}
