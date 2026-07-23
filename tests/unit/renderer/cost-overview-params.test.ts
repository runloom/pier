import { describe, expect, it } from "vitest";
import {
  costOverviewParamsToJson,
  DEFAULT_COST_OVERVIEW_PARAMS,
  normalizeCostOverviewChart,
  paramsFromPreset,
  parseCostOverviewParams,
  patchCostOverviewParams,
} from "@/panel-kits/workbench/core-widgets/cost/cost-overview-params.ts";

describe("parseCostOverviewParams", () => {
  it("returns defaults for empty raw", () => {
    expect(parseCostOverviewParams({})).toEqual(DEFAULT_COST_OVERVIEW_PARAMS);
  });

  it("salvages illegal enums and empty kpis", () => {
    expect(
      parseCostOverviewParams({
        rangeDays: 99,
        measure: "watts",
        groupBy: "account",
        chart: "pie",
        kpis: ["nope"],
        sources: "codex",
      })
    ).toEqual(DEFAULT_COST_OVERVIEW_PARAMS);
  });

  it("keeps valid fields and dedupes kpis in order", () => {
    expect(
      parseCostOverviewParams({
        rangeDays: 7,
        measure: "tokens",
        groupBy: "none",
        chart: "line",
        kpis: ["periodTokens", "today", "periodTokens", "latestDayTokens"],
        sources: ["codex-local-sessions", 1, ""],
        preset: "tokens",
      })
    ).toEqual({
      // fields diverge from tokens template → re-resolve
      preset: "custom",
      rangeDays: 7,
      measure: "tokens",
      groupBy: "none",
      chart: "line",
      kpis: ["periodTokens", "today", "latestDayTokens"],
      sources: ["codex-local-sessions"],
    });
  });

  it("re-resolves official preset when fields do not match template", () => {
    const parsed = parseCostOverviewParams({
      preset: "tokens",
      measure: "cost",
      groupBy: "source",
      chart: "stackedBar",
      rangeDays: 31,
      kpis: ["today", "period", "periodTokens", "latestDayTokens"],
    });
    // overview template, not the claimed tokens label
    expect(parsed.preset).toBe("overview");
    expect(parsed.measure).toBe("cost");
    expect(parsed.groupBy).toBe("source");
  });

  it("corrects chart for groupBy source on parse", () => {
    expect(
      parseCostOverviewParams({ groupBy: "source", chart: "line" }).chart
    ).toBe("stackedBar");
  });

  it("treats null sources as no filter", () => {
    expect(parseCostOverviewParams({ sources: null }).sources).toBeUndefined();
  });

  it("treats empty sources array as no filter", () => {
    expect(parseCostOverviewParams({ sources: [] }).sources).toBeUndefined();
  });
});

describe("normalizeCostOverviewChart", () => {
  it("maps model to ranking and none+ranking to line", () => {
    expect(normalizeCostOverviewChart("model", "stackedBar")).toBe("ranking");
    expect(normalizeCostOverviewChart("none", "ranking")).toBe("line");
    expect(normalizeCostOverviewChart("source", "line")).toBe("stackedBar");
  });
});

describe("patchCostOverviewParams", () => {
  it("restores preset id when fields match a template", () => {
    const tokens = paramsFromPreset("tokens");
    const customish = { ...tokens, preset: "custom" as const };
    expect(patchCostOverviewParams(customish, {}).preset).toBe("tokens");
  });

  it("marks custom when fields diverge", () => {
    const overview = paramsFromPreset("overview");
    expect(patchCostOverviewParams(overview, { rangeDays: 7 }).preset).toBe(
      "custom"
    );
  });

  it("applies preset template when patch.preset is official", () => {
    const next = patchCostOverviewParams(DEFAULT_COST_OVERVIEW_PARAMS, {
      preset: "tokens",
    });
    expect(next).toEqual(paramsFromPreset("tokens"));
  });
});

describe("costOverviewParamsToJson", () => {
  it("writes sources:null when no active filter", () => {
    const json = costOverviewParamsToJson(paramsFromPreset("overview"));
    expect(json.sources).toBeNull();
  });

  it("writes sources allowlist when present", () => {
    const json = costOverviewParamsToJson({
      ...paramsFromPreset("overview"),
      sources: ["codex-local-sessions"],
    });
    expect(json.sources).toEqual(["codex-local-sessions"]);
  });

  it("emits sources:null after patch clears allowlist", () => {
    const filtered = {
      ...paramsFromPreset("overview"),
      sources: ["codex-local-sessions"],
    };
    const cleared = patchCostOverviewParams(filtered, { sources: undefined });
    expect(cleared.sources).toBeUndefined();
    expect(costOverviewParamsToJson(cleared).sources).toBeNull();
  });
});
