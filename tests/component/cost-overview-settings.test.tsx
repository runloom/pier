import type {
  UsageAggregateSnapshot,
  UsageAggregateSource,
  UsageDataDailyBucket,
  UsageTokenTotals,
} from "@shared/contracts/usage-data.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
  costOverviewParamsToJson,
  paramsFromPreset,
} from "@/panel-kits/workbench/core-widgets/cost/cost-overview-params.ts";
import { CostOverviewSettings } from "@/panel-kits/workbench/core-widgets/cost/cost-overview-settings.tsx";
import { useUsageDataStore } from "@/stores/usage-data.store.ts";

async function chooseOption(
  comboboxName: string | RegExp,
  optionName: string | RegExp
) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
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
  cost: number
): UsageDataDailyBucket {
  return {
    date,
    estimatedCostMicrousd: cost,
    pricingStatus: "complete",
    tokens: simpleTokens(tokens),
  };
}

function sourceEntry(
  pluginId: string,
  sourceId: string,
  buckets: readonly UsageDataDailyBucket[]
): UsageAggregateSource {
  return {
    pluginId,
    scope: { kind: "machine" },
    sourceId,
    snapshot: {
      buckets: [...buckets],
      coverage: { complete: true, from: "2026-07-10", to: "2026-07-11" },
      observedAt: 1,
      pluginId,
      scope: { kind: "machine" },
      sourceId,
      summary: {
        byModel: [],
        estimatedCostMicrousd: buckets.reduce(
          (sum, item) => sum + (item.estimatedCostMicrousd ?? 0),
          0
        ),
        latestDayTokens: buckets.at(-1)?.tokens.totalTokens ?? 0,
        periodTokens: buckets.reduce(
          (sum, item) => sum + item.tokens.totalTokens,
          0
        ),
        todayEstimatedCostMicrousd: null,
      },
    },
  };
}

function settingsSnapshot(): UsageAggregateSnapshot {
  return {
    overall: {
      buckets: [
        bucket("2026-07-10", 100, 1_000_000),
        bucket("2026-07-11", 250, 2_500_000),
      ],
      coverage: { complete: true, from: "2026-07-10", to: "2026-07-11" },
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
      sourceEntry("pier.codex", "codex-local-sessions", [
        bucket("2026-07-10", 40, 400_000),
        bucket("2026-07-11", 80, 800_000),
      ]),
      sourceEntry("pier.claude", "claude-code-local-sessions", [
        bucket("2026-07-10", 60, 600_000),
        bucket("2026-07-11", 170, 1_700_000),
      ]),
    ],
  };
}

describe("CostOverviewSettings", () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    useUsageDataStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("writes tokens preset fields through updateParams", async () => {
    const updateParams = vi.fn();
    render(
      <CostOverviewSettings
        instanceId="core.cost-overview"
        params={{}}
        updateParams={updateParams}
      />
    );

    await chooseOption("Preset", "Tokens");

    expect(updateParams).toHaveBeenCalledTimes(1);
    expect(updateParams).toHaveBeenCalledWith(
      costOverviewParamsToJson(paramsFromPreset("tokens"))
    );
  });

  it("marks custom after changing range on overview", async () => {
    const updateParams = vi.fn();
    render(
      <CostOverviewSettings
        instanceId="core.cost-overview"
        params={costOverviewParamsToJson(paramsFromPreset("overview"))}
        updateParams={updateParams}
      />
    );

    await chooseOption("Time range", "7 days");

    expect(updateParams).toHaveBeenCalledTimes(1);
    const next = updateParams.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(next.preset).toBe("custom");
    expect(next.rangeDays).toBe(7);
    expect(next.measure).toBe("cost");
    expect(next.groupBy).toBe("source");
    expect(next.chart).toBe("stackedBar");
  });

  it("does not clear the last remaining KPI", async () => {
    const updateParams = vi.fn();
    render(
      <CostOverviewSettings
        instanceId="core.cost-overview"
        params={{
          ...costOverviewParamsToJson(paramsFromPreset("by-source")),
          kpis: ["today"],
        }}
        updateParams={updateParams}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Today" }));

    expect(updateParams).not.toHaveBeenCalled();
  });

  it("writes by-model preset with model ranking", async () => {
    const updateParams = vi.fn();
    render(
      <CostOverviewSettings
        instanceId="core.cost-overview"
        params={{}}
        updateParams={updateParams}
      />
    );

    await chooseOption("Preset", "By model");

    expect(updateParams).toHaveBeenCalledTimes(1);
    expect(updateParams).toHaveBeenCalledWith(
      costOverviewParamsToJson(paramsFromPreset("by-model"))
    );
    const next = updateParams.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(next.groupBy).toBe("model");
    expect(next.chart).toBe("ranking");
  });

  it("writes a single source allowlist through updateParams", async () => {
    const updateParams = vi.fn();
    act(() => {
      useUsageDataStore.getState().applySnapshot(settingsSnapshot());
    });
    render(
      <CostOverviewSettings
        instanceId="core.cost-overview"
        params={costOverviewParamsToJson(paramsFromPreset("overview"))}
        updateParams={updateParams}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Codex" }));

    expect(updateParams).toHaveBeenCalledTimes(1);
    const next = updateParams.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(next.sources).toEqual(["codex-local-sessions"]);
  });
});
