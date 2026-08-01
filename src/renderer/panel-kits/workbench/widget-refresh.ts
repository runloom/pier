import type {
  RendererWorkbenchWidgetAction,
  WorkbenchWidgetActionContext,
} from "@plugins/api/renderer.ts";
import type { JsonValue } from "@shared/contracts/plugin/settings.ts";
import type { ResolvedWorkbenchWidget } from "./merge.ts";

/** Canonical id for a widget's primary refresh action (plugin or core). */
export const WORKBENCH_REFRESH_ACTION_ID = "refresh";

export type WidgetRefreshMode = "action" | "token" | "none";

export interface WidgetRefreshTarget {
  /** Present when mode === "action". */
  action?: RendererWorkbenchWidgetAction;
  instanceId: string;
  mode: WidgetRefreshMode;
  title: string;
}

export interface RefreshAllWidgetsResult {
  actionCount: number;
  failed: readonly { error: string; instanceId: string; title: string }[];
  skippedCount: number;
  tokenCount: number;
}

function resolveWidgetTitle(widget: ResolvedWorkbenchWidget): string {
  return widget.title;
}

/**
 * Resolve how a single widget participates in refresh.
 *
 * Priority:
 * 1. Registration action with id `"refresh"` (real async RPC / rescan)
 * 2. Manifest `refreshable` on an active/core widget → bump `refreshToken`
 * 3. Otherwise skip (unknown / inactive / non-refreshable without action)
 */
export function resolveWidgetRefreshTarget(
  widget: ResolvedWorkbenchWidget,
  actionContext: WorkbenchWidgetActionContext
): WidgetRefreshTarget {
  const title = resolveWidgetTitle(widget);
  const base = { instanceId: widget.instanceId, title };

  if (
    widget.registration?.actions &&
    (widget.status === "core" || widget.status === "plugin-active")
  ) {
    let actions: readonly RendererWorkbenchWidgetAction[] = [];
    try {
      actions = widget.registration.actions(actionContext);
    } catch {
      // Fall through to token / none; action factory errors surface elsewhere.
      actions = [];
    }
    const refreshAction = actions.find(
      (action) => action.id === WORKBENCH_REFRESH_ACTION_ID
    );
    if (refreshAction) {
      return { ...base, action: refreshAction, mode: "action" };
    }
  }

  if (
    widget.refreshable &&
    (widget.status === "core" || widget.status === "plugin-active")
  ) {
    return { ...base, mode: "token" };
  }

  return { ...base, mode: "none" };
}

export function buildWidgetActionContext(options: {
  bulkRefresh?: boolean;
  instanceId: string;
  params: Readonly<Record<string, JsonValue>>;
  requestRefresh: () => void;
  updateParams: (patch: Record<string, JsonValue>) => void;
}): WorkbenchWidgetActionContext {
  return {
    ...(options.bulkRefresh ? { bulkRefresh: true } : {}),
    instanceId: options.instanceId,
    params: options.params,
    requestRefresh: options.requestRefresh,
    updateParams: options.updateParams,
  };
}

/**
 * Run host "Refresh all": invoke every widget refresh action (bulk) and bump
 * tokens for refreshable token-mode widgets. Never throws — failures are
 * collected for one host-level alert.
 */
export async function refreshAllWorkbenchWidgets(options: {
  bumpTokens: (instanceIds: readonly string[]) => void;
  requestRefresh: (instanceId: string) => void;
  updateParams: (instanceId: string, patch: Record<string, JsonValue>) => void;
  widgets: readonly ResolvedWorkbenchWidget[];
}): Promise<RefreshAllWidgetsResult> {
  const tokenIds: string[] = [];
  const actionJobs: Array<{
    instanceId: string;
    title: string;
    run: () => Promise<void>;
  }> = [];
  let skippedCount = 0;

  for (const widget of options.widgets) {
    const actionContext = buildWidgetActionContext({
      bulkRefresh: true,
      instanceId: widget.instanceId,
      params: widget.params,
      requestRefresh: () => options.requestRefresh(widget.instanceId),
      updateParams: (patch) => options.updateParams(widget.instanceId, patch),
    });
    const target = resolveWidgetRefreshTarget(widget, actionContext);
    if (target.mode === "token") {
      tokenIds.push(widget.instanceId);
    } else if (target.mode === "action" && target.action) {
      const action = target.action;
      actionJobs.push({
        instanceId: widget.instanceId,
        title: target.title,
        run: async () => {
          await action.invoke(actionContext);
        },
      });
    } else {
      skippedCount += 1;
    }
  }

  if (tokenIds.length > 0) {
    options.bumpTokens(tokenIds);
  }

  const failed: { error: string; instanceId: string; title: string }[] = [];
  if (actionJobs.length > 0) {
    const settled = await Promise.allSettled(
      actionJobs.map((job) => job.run())
    );
    for (const [index, result] of settled.entries()) {
      if (result.status === "rejected") {
        const job = actionJobs[index];
        if (!job) continue;
        failed.push({
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
          instanceId: job.instanceId,
          title: job.title,
        });
      }
    }
  }

  return {
    actionCount: actionJobs.length,
    failed,
    skippedCount,
    tokenCount: tokenIds.length,
  };
}
