import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

async function chooseOption(
  comboboxName: string | RegExp,
  optionName: string | RegExp
) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

describe("CostOverviewSettings", () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
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
});
