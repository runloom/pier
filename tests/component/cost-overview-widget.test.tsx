import type { WorkbenchWidgetComponentProps } from "@plugins/api/renderer.ts";
import type {
  UsageAggregateSnapshot,
  UsageAggregateSource,
  UsageDataDailyBucket,
  UsageDataPricingStatus,
  UsageDataSnapshot,
  UsageTokenTotals,
} from "@shared/contracts/usage-data.ts";
import { act, cleanup, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  CostOverviewWidget,
  costOverviewWidgetActions,
} from "@/panel-kits/workbench/core-widgets/cost-overview-widget.tsx";
import { useUsageDataStore } from "@/stores/usage-data.store.ts";

vi.mock("sonner", () => ({
  toast: { success: vi.fn() },
}));

const originalPierDescriptor = Object.getOwnPropertyDescriptor(window, "pier");

function baseProps(
  overrides: Partial<WorkbenchWidgetComponentProps> = {}
): WorkbenchWidgetComponentProps {
  return {
    instanceId: "core.cost-overview",
    params: {},
    refreshToken: 0,
    size: { h: 3, w: 4 },
    updateParams: vi.fn(),
    visible: true,
    ...overrides,
  };
}

function renderWidget(props?: Partial<WorkbenchWidgetComponentProps>) {
  return render(<CostOverviewWidget {...baseProps(props)} />);
}

function simpleTokens(count: number): UsageTokenTotals {
  return {
    cachedInputTokens: 0,
    inputTokens: count,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: count,
  };
}

function bucket(
  date: string,
  tokens: number,
  cost: number | null,
  status: UsageDataPricingStatus = "complete"
): UsageDataDailyBucket {
  return {
    date,
    estimatedCostMicrousd: cost,
    pricingStatus: status,
    tokens: simpleTokens(tokens),
  };
}

function sourceSnapshot(
  pluginId: string,
  buckets: readonly UsageDataDailyBucket[],
  totalCost: number | null
): UsageAggregateSource {
  const snapshot: UsageDataSnapshot = {
    buckets: [...buckets],
    coverage: { complete: true, from: "2026-07-10", to: "2026-07-11" },
    observedAt: 1,
    pluginId,
    scope: { kind: "machine" },
    sourceId: "local-sessions",
    summary: {
      byModel: [],
      estimatedCostMicrousd: totalCost,
      latestDayTokens: buckets.at(-1)?.tokens.totalTokens ?? 0,
      periodTokens: buckets.reduce((sum, b) => sum + b.tokens.totalTokens, 0),
      todayEstimatedCostMicrousd: null,
    },
  };
  return {
    pluginId,
    scope: { kind: "machine" },
    snapshot,
    sourceId: "local-sessions",
  };
}

function loadedSnapshot(): UsageAggregateSnapshot {
  return {
    overall: {
      buckets: [
        bucket("2026-07-10", 100, 1_000_000),
        bucket("2026-07-11", 250, 2_500_000, "partial"),
      ],
      coverage: { complete: false, from: "2026-07-10", to: "2026-07-11" },
      observedAt: Date.now(),
      summary: {
        byModel: [],
        estimatedCostMicrousd: 3_500_000,
        latestDayTokens: 250,
        periodTokens: 350,
        sourceCount: 2,
        todayEstimatedCostMicrousd: 500_000,
      },
    },
    sources: [
      sourceSnapshot(
        "pier.codex",
        [bucket("2026-07-10", 40, 400_000), bucket("2026-07-11", 80, 800_000)],
        1_200_000
      ),
      sourceSnapshot(
        "pier.claude",
        [
          bucket("2026-07-10", 60, 600_000),
          bucket("2026-07-11", 170, 1_700_000, "partial"),
        ],
        2_300_000
      ),
    ],
  };
}

function emptySnapshot(): UsageAggregateSnapshot {
  return {
    overall: {
      buckets: [],
      coverage: { complete: true, from: "2026-07-11", to: "2026-07-11" },
      observedAt: 1,
      summary: {
        byModel: [],
        estimatedCostMicrousd: null,
        latestDayTokens: 0,
        periodTokens: 0,
        sourceCount: 0,
        todayEstimatedCostMicrousd: null,
      },
    },
    sources: [],
  };
}

beforeAll(async () => {
  await initI18n();
});

beforeEach(() => {
  useUsageDataStore.getState().reset();
});

afterEach(() => {
  cleanup();
  if (originalPierDescriptor) {
    Object.defineProperty(window, "pier", originalPierDescriptor);
  } else {
    Reflect.deleteProperty(window, "pier");
  }
  vi.restoreAllMocks();
});

describe("CostOverviewWidget", () => {
  it("renders the shared loading skeleton before the store hydrates", () => {
    renderWidget();
    expect(
      document.querySelector('[data-slot="widget-skeleton"]')
    ).toBeInTheDocument();
  });

  it("renders the empty state when the aggregate contains no sources", () => {
    act(() => {
      useUsageDataStore.getState().applySnapshot(emptySnapshot());
    });
    renderWidget();
    expect(
      document.querySelector('[data-slot="widget-empty"]')
    ).toBeInTheDocument();
  });

  it("renders the shared error state when the initial load fails", () => {
    act(() => {
      useUsageDataStore.getState().applyError(new Error("initial boom"));
    });
    renderWidget();
    expect(
      document.querySelector('[data-slot="widget-error"]')
    ).toHaveTextContent("initial boom");
  });

  it("renders KPI tiles and the stacked bar chart when data is loaded", () => {
    act(() => {
      useUsageDataStore.getState().applySnapshot(loadedSnapshot());
    });
    renderWidget({ size: { h: 3, w: 8 } });
    expect(screen.getByTestId("cost-overview-kpis")).toBeInTheDocument();
    expect(screen.getByTestId("cost-overview-chart")).toBeInTheDocument();
  });

  it("hides the description at the minimum height", () => {
    act(() => {
      useUsageDataStore.getState().applySnapshot(loadedSnapshot());
    });
    const { rerender } = renderWidget({ size: { h: 2, w: 8 } });
    expect(
      screen.queryByTestId("cost-overview-description")
    ).not.toBeInTheDocument();

    rerender(<CostOverviewWidget {...baseProps({ size: { h: 3, w: 8 } })} />);
    expect(screen.getByTestId("cost-overview-description")).toBeInTheDocument();
  });

  it("keeps a minimum chart height when dense content needs to scroll", () => {
    act(() => {
      useUsageDataStore.getState().applySnapshot(loadedSnapshot());
    });
    renderWidget({ size: { h: 2, w: 4 } });
    expect(screen.getByTestId("cost-overview-content")).toHaveClass(
      "h-full",
      "min-h-0",
      "overflow-y-auto"
    );
    expect(screen.getByTestId("cost-overview-chart")).toHaveClass("min-h-8");
    expect(screen.getByTestId("cost-overview-chart")).not.toHaveClass(
      "min-h-0"
    );
  });

  it("preserves unknown costs instead of formatting them as zero", () => {
    const unknown = loadedSnapshot();
    unknown.overall.summary.estimatedCostMicrousd = null;
    unknown.overall.summary.todayEstimatedCostMicrousd = null;
    act(() => {
      useUsageDataStore.getState().applySnapshot(unknown);
    });
    renderWidget({ size: { h: 3, w: 8 } });
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("exposes a refresh action that awaits usageData.refreshAll", async () => {
    const refreshAll = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { ...window.pier, usageData: { refreshAll } },
    });
    const [action] = costOverviewWidgetActions({
      instanceId: "core.cost-overview",
      params: {},
      requestRefresh: vi.fn(),
      updateParams: vi.fn(),
    });
    expect(action?.id).toBe("refresh");
    await action?.invoke({
      instanceId: "core.cost-overview",
      params: {},
      requestRefresh: vi.fn(),
      updateParams: vi.fn(),
    });
    expect(refreshAll).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Cost refreshed");
  });

  it("does not read the store while the panel is hidden", () => {
    act(() => {
      useUsageDataStore.getState().applySnapshot(loadedSnapshot());
    });
    renderWidget({ visible: false });
    expect(
      document.querySelector('[data-slot="widget-skeleton"]')
    ).toBeInTheDocument();
    expect(screen.queryByTestId("cost-overview-kpis")).not.toBeInTheDocument();
  });
});
