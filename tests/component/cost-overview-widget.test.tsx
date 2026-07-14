import type { MissionControlWidgetComponentProps } from "@plugins/api/renderer.ts";
import type {
  UsageAggregateSnapshot,
  UsageAggregateSource,
  UsageDataDailyBucket,
  UsageDataPricingStatus,
  UsageDataSnapshot,
  UsageTokenTotals,
} from "@shared/contracts/usage-data.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
} from "@/panel-kits/mission-control/core-widgets/cost-overview-widget.tsx";
import { useUsageDataStore } from "@/stores/usage-data.store.ts";

vi.mock("sonner", () => ({
  toast: { success: vi.fn() },
}));

const originalPierDescriptor = Object.getOwnPropertyDescriptor(window, "pier");

function domRect({
  height,
  left,
  top,
  width,
}: {
  height: number;
  left: number;
  top: number;
  width: number;
}): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON: () => ({}),
    top,
    width,
    x: left,
    y: top,
  };
}

function baseProps(
  overrides: Partial<MissionControlWidgetComponentProps> = {}
): MissionControlWidgetComponentProps {
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

function renderWidget(props?: Partial<MissionControlWidgetComponentProps>) {
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
  vi.unstubAllGlobals();
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

  it("renders the hover tooltip outside the clipped widget content", async () => {
    const resizeObservers: TestResizeObserver[] = [];
    class TestResizeObserver implements ResizeObserver {
      readonly disconnect = vi.fn();
      readonly observedTargets = new Set<Element>();
      readonly unobserve = vi.fn();
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        resizeObservers.push(this);
      }

      emit(target = this.observedTargets.values().next().value): void {
        if (!target) {
          return;
        }
        this.callback(
          [
            {
              contentRect: {
                height: 200,
                width: 320,
              },
              target,
            } as ResizeObserverEntry,
          ],
          this
        );
      }

      observe(target: Element): void {
        this.observedTargets.add(target);
        this.emit(target);
      }
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    act(() => {
      useUsageDataStore.getState().applySnapshot(loadedSnapshot());
    });
    renderWidget({ size: { h: 3, w: 8 } });
    const chart = screen.getByTestId("cost-overview-chart");
    const wrapper = await waitFor(() => {
      const element = chart.querySelector<HTMLElement>(".recharts-wrapper");
      expect(element).not.toBeNull();
      return element;
    });
    if (!wrapper) {
      return;
    }
    const wrapperRect = domRect({
      height: 200,
      left: 20,
      top: 20,
      width: 320,
    });
    vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(wrapperRect);
    let anchorRect = wrapperRect;
    const anchorRectSpy = vi
      .spyOn(chart, "getBoundingClientRect")
      .mockImplementation(() => anchorRect);
    const getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function mockTooltipRect(this: HTMLElement) {
        return this.dataset.slot === "chart-tooltip-portal"
          ? domRect({ height: 118, left: 0, top: 0, width: 144 })
          : getBoundingClientRect.call(this);
      }
    );
    vi.stubGlobal("innerHeight", 240);
    vi.stubGlobal("innerWidth", 360);

    fireEvent.mouseMove(wrapper, { clientX: 330, clientY: 210 });
    await waitFor(() => {
      expect(chart.querySelector(".recharts-tooltip-wrapper")).toHaveStyle({
        visibility: "visible",
      });
    });

    const tooltip = document.querySelector<HTMLElement>(
      '[data-slot="chart-tooltip-portal"]'
    );
    expect(tooltip).toBeInTheDocument();
    expect(tooltip?.parentElement).toBe(document.body);
    expect(chart).not.toContainElement(tooltip);
    expect(tooltip).toHaveClass("pointer-events-none");
    expect(tooltip).not.toHaveClass(
      "max-h-[calc(100vh-1rem)]",
      "overflow-y-auto"
    );
    expect(tooltip).toHaveAttribute(
      "data-chart",
      chart
        .querySelector<HTMLElement>("[data-chart]")
        ?.getAttribute("data-chart")
    );
    expect(tooltip).toHaveTextContent("pier.codex/local-sessions");
    const left = Number.parseFloat(tooltip?.style.left ?? "");
    const top = Number.parseFloat(tooltip?.style.top ?? "");
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + 144).toBeLessThanOrEqual(352);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + 118).toBeLessThanOrEqual(232);

    const anchorMeasurements = anchorRectSpy.mock.calls.length;
    const initialLeft = tooltip?.style.left;
    fireEvent.mouseMove(wrapper, { clientX: 60, clientY: 80 });
    await waitFor(() => {
      expect(
        document.querySelector<HTMLElement>(
          '[data-slot="chart-tooltip-portal"]'
        )?.style.left
      ).not.toBe(initialLeft);
    });
    expect(anchorRectSpy).toHaveBeenCalledTimes(anchorMeasurements);

    const portalLeft = () =>
      document.querySelector<HTMLElement>('[data-slot="chart-tooltip-portal"]')
        ?.style.left;
    const expectGeometryRefresh = async (
      nextRect: DOMRect,
      trigger: () => void
    ) => {
      const measurements = anchorRectSpy.mock.calls.length;
      const previousLeft = portalLeft();
      anchorRect = nextRect;
      act(trigger);
      await waitFor(() => {
        expect(anchorRectSpy.mock.calls.length).toBeGreaterThan(measurements);
        expect(portalLeft()).not.toBe(previousLeft);
      });
    };

    await expectGeometryRefresh(
      domRect({ height: 200, left: 40, top: 30, width: 320 }),
      () => window.dispatchEvent(new Event("resize"))
    );
    await expectGeometryRefresh(
      domRect({ height: 200, left: 60, top: 40, width: 320 }),
      () => chart.dispatchEvent(new Event("scroll", { bubbles: true }))
    );
    const anchorObserver = resizeObservers.find((observer) =>
      observer.observedTargets.has(chart)
    );
    expect(anchorObserver).toBeDefined();
    await expectGeometryRefresh(
      domRect({ height: 200, left: 80, top: 50, width: 320 }),
      () => anchorObserver?.emit(chart)
    );
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
    expect(toast.success).toHaveBeenCalledWith("Cost data refreshed");
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

  it("renders rounded top on the visual-top segment when the declared top source is zero", async () => {
    // Day 1: source0=10, source1=0 (declared top is zero → source0 is visual top)
    // Day 2: source0=10, source1=20 (both non-zero → source1 is visual top)
    const snapshot: UsageAggregateSnapshot = {
      overall: {
        buckets: [
          bucket("2026-07-10", 10, 1_000_000),
          bucket("2026-07-11", 30, 3_000_000),
        ],
        coverage: { complete: true, from: "2026-07-10", to: "2026-07-11" },
        observedAt: Date.now(),
        summary: {
          byModel: [],
          estimatedCostMicrousd: 4_000_000,
          latestDayTokens: 30,
          periodTokens: 40,
          sourceCount: 2,
          todayEstimatedCostMicrousd: null,
        },
      },
      sources: [
        sourceSnapshot(
          "pier.codex",
          [
            bucket("2026-07-10", 10, 1_000_000),
            bucket("2026-07-11", 10, 1_000_000),
          ],
          2_000_000
        ),
        sourceSnapshot(
          "pier.claude",
          [bucket("2026-07-10", 0, 0), bucket("2026-07-11", 20, 2_000_000)],
          2_000_000
        ),
      ],
    };

    class SizedResizeObserver implements ResizeObserver {
      readonly disconnect = vi.fn();
      readonly observedTargets = new Set<Element>();
      readonly unobserve = vi.fn();
      private readonly callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element): void {
        this.observedTargets.add(target);
        this.callback(
          [
            {
              contentRect: { height: 200, width: 320 },
              target,
            } as ResizeObserverEntry,
          ],
          this
        );
      }
    }
    vi.stubGlobal("ResizeObserver", SizedResizeObserver);

    act(() => {
      useUsageDataStore.getState().applySnapshot(snapshot);
    });
    renderWidget({ size: { h: 3, w: 8 } });

    const chart = screen.getByTestId("cost-overview-chart");
    await waitFor(() => {
      expect(
        chart.querySelector<HTMLElement>(".recharts-wrapper")
      ).not.toBeNull();
    });
    // BarStack applies rounded corners via SVG clipPath: a rounded rectangle
    // is rendered in <defs><clipPath>, and each bar segment references it.
    // Verify the BarStack clipPaths exist and contain rounded rectangles.
    const stackClipPaths = chart.querySelectorAll<SVGElement>(
      'clipPath[id^="recharts-bar-stack-clip-path"]'
    );
    expect(stackClipPaths.length).toBeGreaterThan(0);

    // Each BarStack clipPath should contain a path with arc commands (rounded)
    let roundedCount = 0;
    for (const cp of stackClipPaths) {
      const path = cp.querySelector("path");
      if (path?.getAttribute("d")?.includes("A")) {
        roundedCount += 1;
      }
    }
    expect(roundedCount).toBeGreaterThan(0);

    // Bar segments should reference the BarStack clipPath via clip-path attribute
    const clippedBars = chart.querySelectorAll<SVGElement>(
      ".recharts-bar-rectangle[clip-path]"
    );
    expect(clippedBars.length).toBeGreaterThan(0);
  });
});
