import type { GitStatus } from "@shared/contracts/git.ts";

/** 远程主动作（状态栏 / 下拉 / 命令面板共用）。 */
export type RemoteSyncActionId =
  | "fetch"
  | "publish"
  | "pull"
  | "push"
  | "syncChanges";

export type RemoteSyncBlockReason =
  | "authRequired"
  | "detached"
  | "pullBlocked"
  | "unavailable";

export type RemoteSyncDecision =
  | { action: RemoteSyncActionId; kind: "action" }
  | { kind: "blocked"; reason: RemoteSyncBlockReason };

export interface I18nMessage {
  fallback: string;
  key: string;
}

function canUseUpstream(status: GitStatus): boolean {
  return (
    status.branch.upstream !== null &&
    !status.branch.upstreamGone &&
    status.remoteSync?.state !== "authRequired"
  );
}

/**
 * 可发布 / 重新发布：
 * - 无上游：首次发布
 * - 上游已删：push -u 重建跟踪
 */
export function canPublishBranch(status: GitStatus): boolean {
  return (
    status.repoState.kind === "clean" &&
    status.branch.branch !== null &&
    (status.branch.upstream === null || status.branch.upstreamGone)
  );
}

export function isSyncUncertain(status: GitStatus): boolean {
  return (
    status.remoteSync?.state === "authRequired" ||
    status.remoteSync?.lastSuccessAt === null
  );
}

/**
 * How long a successful fetch keeps the "Fetch remote" status/task chrome hidden.
 * Aligns with VS Code-style: primary chrome is pull/push/sync; fetch only when
 * the remote snapshot is missing, untrusted, or stale.
 */
export const GIT_FETCH_TASK_STALE_MS = 15 * 60 * 1000;

/**
 * Whether to surface a Fetch entry (status bar action or dropdown task).
 * Not for pull/push/sync — those remain decision-driven.
 */
export function shouldOfferFetchTask(
  status: GitStatus,
  nowMs: number = Date.now()
): boolean {
  const sync = status.remoteSync;
  // null/undefined: no autofetch record — manual fetch is the way to refresh.
  if (sync == null) {
    return true;
  }
  if (sync.state === "authRequired") {
    return true;
  }
  if (sync.state === "fetching") {
    // In-flight autofetch/manual busy — avoid a second competing entry.
    return false;
  }
  if (sync.lastSuccessAt == null) {
    return true;
  }
  // backoff / idle with a successful fetch: hide while still fresh.
  return nowMs - sync.lastSuccessAt >= GIT_FETCH_TASK_STALE_MS;
}

/**
 * Status-bar / chrome action after Model A filter:
 * hide "fetch" when the remote snapshot is already fresh.
 *
 * Unlike {@link shouldOfferFetchTask}, chrome keeps fetch while a fetch is in
 * flight (`remoteSync.state === "fetching"` or local `busy`) so the status-bar
 * control does not lose loader / label mid-operation. Task list still hides a
 * second competing entry via shouldOfferFetchTask alone.
 */
export function resolveRemoteSyncActionIdForChrome(
  status: GitStatus,
  nowMs: number = Date.now(),
  options: { busy?: boolean } = {}
): null | RemoteSyncActionId {
  const actionId = resolveRemoteSyncActionId(status);
  if (actionId !== "fetch") {
    return actionId;
  }
  // Keep identity while fetch is running (record and/or local trackSync busy).
  // shouldOfferFetchTask is false for state==="fetching"; that must not strip chrome.
  if (status.remoteSync?.state === "fetching" || options.busy) {
    return "fetch";
  }
  if (!shouldOfferFetchTask(status, nowMs)) {
    return null;
  }
  return "fetch";
}

/**
 * 远程同步决策（单一真源）。
 * - 无上游或上游已删 → publish
 * - 已同步 → fetch（状态栏主按钮用；下拉不把 fetch 当情境行，任务区按需展示）
 * - 脏 + 仅 behind → blocked pull；脏 + 分叉 → push
 * - 干净分叉 → sync；仅 ahead → push；仅 behind → pull
 */
export function resolveRemoteSyncDecision(
  status: GitStatus
): RemoteSyncDecision {
  if (status.repoState.kind !== "clean") {
    return { kind: "blocked", reason: "unavailable" };
  }
  if (canPublishBranch(status)) {
    return { action: "publish", kind: "action" };
  }
  if (status.remoteSync?.state === "authRequired") {
    return { kind: "blocked", reason: "authRequired" };
  }
  if (status.branch.branch === null) {
    return { kind: "blocked", reason: "detached" };
  }
  if (!canUseUpstream(status)) {
    return { kind: "blocked", reason: "unavailable" };
  }
  const { ahead, behind } = status.branch;
  const hasLocalChanges = status.changeSummary.changedFiles > 0;
  if (ahead === 0 && behind === 0) {
    return { action: "fetch", kind: "action" };
  }
  if (behind > 0 && hasLocalChanges) {
    if (ahead > 0) {
      return { action: "push", kind: "action" };
    }
    return { kind: "blocked", reason: "pullBlocked" };
  }
  if (ahead > 0 && behind > 0) {
    return { action: "syncChanges", kind: "action" };
  }
  if (ahead > 0) {
    return { action: "push", kind: "action" };
  }
  return { action: "pull", kind: "action" };
}

export function resolveRemoteSyncActionId(
  status: GitStatus
): null | RemoteSyncActionId {
  const decision = resolveRemoteSyncDecision(status);
  return decision.kind === "action" ? decision.action : null;
}

export function resolveRemoteSyncBlockReason(
  status: GitStatus
): null | RemoteSyncBlockReason {
  const decision = resolveRemoteSyncDecision(status);
  return decision.kind === "blocked" ? decision.reason : null;
}

/** 命令面板：期望动作与当前决策不一致时的文案。 */
const MISMATCH_MESSAGES: Readonly<Partial<Record<string, I18nMessage>>> = {
  "pull:push": {
    fallback:
      "Commit or stash local changes before pulling. You can still push local commits.",
    key: "gitPullBlockedLocalChanges",
  },
  "pull:publish": {
    fallback:
      "This branch has no upstream yet. Publish the branch first, or fetch remote updates.",
    key: "gitRemoteErrorNoUpstream",
  },
  "pull:syncChanges": {
    fallback: "This branch has diverged. Use Sync instead of Pull.",
    key: "gitPullUseSyncInstead",
  },
  "publish:fetch": {
    fallback: "This branch already has an upstream. Use Push or Sync instead.",
    key: "gitPublishAlreadyHasUpstream",
  },
  "publish:pull": {
    fallback: "This branch already has an upstream. Use Push or Sync instead.",
    key: "gitPublishAlreadyHasUpstream",
  },
  "publish:push": {
    fallback: "This branch already has an upstream. Use Push or Sync instead.",
    key: "gitPublishAlreadyHasUpstream",
  },
  "publish:syncChanges": {
    fallback: "This branch already has an upstream. Use Push or Sync instead.",
    key: "gitPublishAlreadyHasUpstream",
  },
  "syncChanges:publish": {
    fallback:
      "This branch has no upstream yet. Publish the branch first, or fetch remote updates.",
    key: "gitRemoteErrorNoUpstream",
  },
  "syncChanges:pull": {
    fallback: "Only remote commits are missing. Use Pull instead of Sync.",
    key: "gitSyncUsePullInstead",
  },
  "syncChanges:push": {
    fallback: "Only local commits need to go up. Use Push instead of Sync.",
    key: "gitSyncUsePushInstead",
  },
};

const UNAVAILABLE_MSG: I18nMessage = {
  fallback: "Remote sync is not available right now",
  key: "statusRowSyncUnavailable",
};

/**
 * 固定动作命令（pull / publish / sync）门控。
 * null = 可执行；否则返回 i18n 键。
 */
export function mismatchMessageForCommand(
  expected: RemoteSyncActionId,
  actual: null | RemoteSyncActionId
): I18nMessage | null {
  if (actual === expected) {
    return null;
  }
  const key = `${expected}:${actual ?? "null"}`;
  return MISMATCH_MESSAGES[key] ?? UNAVAILABLE_MSG;
}

export type PushCommandResolve =
  | { action: "publish" | "push"; kind: "run" }
  | { kind: "refuse"; message: I18nMessage };

/** Push 命令：可发布则 publish，可推则 push，否则拒绝。 */
export function resolvePushCommand(status: GitStatus): PushCommandResolve {
  const decision = resolveRemoteSyncDecision(status);
  if (decision.kind === "action" && decision.action === "publish") {
    return { action: "publish", kind: "run" };
  }
  if (
    decision.kind === "action" &&
    (decision.action === "push" || decision.action === "syncChanges")
  ) {
    return { action: "push", kind: "run" };
  }
  if (decision.kind === "action" && decision.action === "pull") {
    return {
      kind: "refuse",
      message: {
        fallback:
          "There are no local commits to push. Pull remote updates if needed.",
        key: "gitPushNothingToPush",
      },
    };
  }
  if (decision.kind === "action" && decision.action === "fetch") {
    return {
      kind: "refuse",
      message: {
        fallback: "This branch is already in sync with its upstream.",
        key: "gitPushAlreadySynced",
      },
    };
  }
  return { kind: "refuse", message: UNAVAILABLE_MSG };
}

export type RemoteChromeSpin = "loader" | "semantic" | false;

/** 状态栏 chrome：按动作查表，避免 isPublish/isFetch 布尔森林。 */
export interface RemoteSyncChrome {
  busyFallback: string;
  busyKey: string;
  detailFallback: string;
  detailKey: string;
  gitIcon: string;
  labelFallback: string;
  labelKey: string;
  /** busy 时：semantic=转动作图标；loader=换 Loader2；false=不转 */
  spin: RemoteChromeSpin;
  tooltipFallback: string;
  tooltipKey: string;
}

export const REMOTE_SYNC_CHROME: Record<RemoteSyncActionId, RemoteSyncChrome> =
  {
    fetch: {
      busyFallback: "Fetching remote…",
      busyKey: "statusDropdownFetching",
      detailFallback: "Refresh remote branch data",
      detailKey: "statusRowFetchDetail",
      gitIcon: "git-fetch",
      labelFallback: "Fetch",
      labelKey: "statusRowFetch",
      spin: "loader",
      tooltipFallback: "Fetch",
      tooltipKey: "statusDropdownFetch",
    },
    publish: {
      busyFallback: "Publishing branch…",
      busyKey: "statusDropdownPublishing",
      detailFallback: "Push to the remote and set the upstream branch",
      detailKey: "statusRowPublishDetail",
      gitIcon: "git-publish",
      labelFallback: "Publish Branch",
      labelKey: "statusRowPublish",
      spin: "loader",
      tooltipFallback: "Publish Branch",
      tooltipKey: "statusDropdownPublish",
    },
    pull: {
      busyFallback: "Pulling changes…",
      busyKey: "statusDropdownPulling",
      detailFallback: "",
      detailKey: "",
      gitIcon: "git-sync",
      labelFallback: "Sync changes",
      labelKey: "statusSyncLabel",
      spin: "semantic",
      tooltipFallback: "Pull Changes",
      tooltipKey: "statusDropdownPull",
    },
    push: {
      busyFallback: "Pushing changes…",
      busyKey: "statusDropdownPushing",
      detailFallback: "",
      detailKey: "",
      gitIcon: "git-sync",
      labelFallback: "Sync changes",
      labelKey: "statusSyncLabel",
      spin: "semantic",
      tooltipFallback: "Push Changes",
      tooltipKey: "statusDropdownPush",
    },
    syncChanges: {
      busyFallback: "Syncing changes…",
      busyKey: "statusDropdownSyncing",
      detailFallback: "",
      detailKey: "",
      gitIcon: "git-sync",
      labelFallback: "Sync changes",
      labelKey: "statusSyncLabel",
      spin: "semantic",
      tooltipFallback: "Sync Changes",
      tooltipKey: "statusDropdownSync",
    },
  };

/** 上游已删时的 publish chrome 覆盖。 */
export const REPUBLISH_CHROME_OVERRIDE: Pick<
  RemoteSyncChrome,
  "detailFallback" | "detailKey" | "labelFallback" | "labelKey"
> = {
  detailFallback:
    "The remote branch was deleted. Publish again to recreate it and set upstream.",
  detailKey: "statusRowRepublishDetail",
  labelFallback: "Publish Branch Again",
  labelKey: "statusRowRepublish",
};

export function chromeForAction(
  action: RemoteSyncActionId,
  options: { upstreamGone?: boolean } = {}
): RemoteSyncChrome {
  const base = REMOTE_SYNC_CHROME[action];
  if (action === "publish" && options.upstreamGone) {
    return { ...base, ...REPUBLISH_CHROME_OVERRIDE };
  }
  return base;
}
