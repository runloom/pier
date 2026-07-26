import { RefreshCw } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import type {
  RendererWorkbenchWidgetRegistration,
  WorkbenchWidgetActionContext,
} from "../../../src/plugins/api/workbench.ts";
import type { ResolvedWorkbenchWidget } from "../../../src/renderer/panel-kits/workbench/workbench-merge.ts";
import {
  buildWidgetActionContext,
  refreshAllWorkbenchWidgets,
  resolveWidgetRefreshTarget,
  WORKBENCH_REFRESH_ACTION_ID,
} from "../../../src/renderer/panel-kits/workbench/workbench-widget-refresh.ts";

function baseWidget(
  overrides: Partial<ResolvedWorkbenchWidget> & {
    registration?: RendererWorkbenchWidgetRegistration | null;
  } = {}
): ResolvedWorkbenchWidget {
  return {
    configurable: false,
    instanceId: "inst-1",
    multiInstance: false,
    params: {},
    refreshable: false,
    registration: null,
    status: "core",
    title: "Widget",
    widgetId: "core.widget",
    ...overrides,
  };
}

function actionContext(bulkRefresh = false): WorkbenchWidgetActionContext {
  return buildWidgetActionContext({
    bulkRefresh,
    instanceId: "inst-1",
    params: {},
    requestRefresh: vi.fn(),
    updateParams: vi.fn(),
  });
}

describe("resolveWidgetRefreshTarget", () => {
  it("prefers a registration refresh action over refreshable token", () => {
    const invoke = vi.fn();
    const registration: RendererWorkbenchWidgetRegistration = {
      actions: () => [
        {
          icon: RefreshCw,
          id: WORKBENCH_REFRESH_ACTION_ID,
          invoke,
          label: "Refresh",
        },
      ],
      component: () => null,
      icon: RefreshCw,
      id: "core.cost",
    };
    const target = resolveWidgetRefreshTarget(
      baseWidget({ refreshable: true, registration, title: "Cost" }),
      actionContext()
    );
    expect(target.mode).toBe("action");
    expect(target.action?.invoke).toBe(invoke);
  });

  it("falls back to token when refreshable without refresh action", () => {
    const target = resolveWidgetRefreshTarget(
      baseWidget({
        refreshable: true,
        registration: {
          component: () => null,
          icon: RefreshCw,
          id: "core.resources",
        },
        title: "Resources",
      }),
      actionContext()
    );
    expect(target).toMatchObject({ mode: "token", instanceId: "inst-1" });
  });

  it("skips unknown and non-refreshable widgets", () => {
    expect(
      resolveWidgetRefreshTarget(
        baseWidget({ status: "unknown", refreshable: true }),
        actionContext()
      ).mode
    ).toBe("none");
    expect(
      resolveWidgetRefreshTarget(
        baseWidget({ refreshable: false }),
        actionContext()
      ).mode
    ).toBe("none");
  });
});

describe("refreshAllWorkbenchWidgets", () => {
  it("invokes action-mode widgets with bulkRefresh and bumps token-mode", async () => {
    const actionInvoke = vi.fn(
      async (_context: WorkbenchWidgetActionContext) => undefined
    );
    const bumpTokens = vi.fn();
    const widgets: ResolvedWorkbenchWidget[] = [
      baseWidget({
        instanceId: "cost-1",
        registration: {
          actions: () => [
            {
              icon: RefreshCw,
              id: "refresh",
              invoke: actionInvoke,
              label: "Refresh",
            },
          ],
          component: () => null,
          icon: RefreshCw,
          id: "core.cost",
        },
        title: "Cost",
        widgetId: "core.cost",
      }),
      baseWidget({
        instanceId: "res-1",
        refreshable: true,
        registration: {
          component: () => null,
          icon: RefreshCw,
          id: "core.resources",
        },
        title: "Resources",
        widgetId: "core.resources",
      }),
      baseWidget({
        instanceId: "idle-1",
        refreshable: false,
        title: "Activity",
        widgetId: "core.activity",
      }),
    ];

    const result = await refreshAllWorkbenchWidgets({
      bumpTokens,
      requestRefresh: vi.fn(),
      updateParams: vi.fn(),
      widgets,
    });

    expect(actionInvoke).toHaveBeenCalledTimes(1);
    expect(actionInvoke.mock.calls[0]?.[0]).toMatchObject({
      bulkRefresh: true,
      instanceId: "cost-1",
    });
    expect(bumpTokens).toHaveBeenCalledWith(["res-1"]);
    expect(result).toEqual({
      actionCount: 1,
      failed: [],
      skippedCount: 1,
      tokenCount: 1,
    });
  });

  it("collects action failures without throwing", async () => {
    const widgets: ResolvedWorkbenchWidget[] = [
      baseWidget({
        instanceId: "acc-1",
        registration: {
          actions: () => [
            {
              icon: RefreshCw,
              id: "refresh",
              invoke: async () => {
                throw new Error("quota down");
              },
              label: "Refresh",
            },
          ],
          component: () => null,
          icon: RefreshCw,
          id: "pier.codex.accounts",
        },
        title: "Codex",
        widgetId: "pier.codex.accounts",
      }),
    ];

    const result = await refreshAllWorkbenchWidgets({
      bumpTokens: vi.fn(),
      requestRefresh: vi.fn(),
      updateParams: vi.fn(),
      widgets,
    });

    expect(result.failed).toEqual([
      {
        error: "quota down",
        instanceId: "acc-1",
        title: "Codex",
      },
    ]);
  });
});
