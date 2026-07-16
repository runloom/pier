import { CORE_COST_OVERVIEW_WIDGET_ID } from "@shared/plugin-core-contribution-ids.ts";
import { describe, expect, it } from "vitest";
import {
  CORE_WORKBENCH_WIDGET_COMPONENTS,
  CORE_WORKBENCH_WIDGETS,
} from "@/panel-kits/workbench/core-workbench-widgets.ts";

describe("CORE_WORKBENCH_WIDGETS", () => {
  it("keeps unique widget ids (Map merge last-wins must not hide bad keys)", () => {
    const ids = CORE_WORKBENCH_WIDGETS.map((widget) => widget.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it("uses workbench i18n keys for cost overview (not legacy missionControl)", () => {
    const cost = CORE_WORKBENCH_WIDGETS.find(
      (widget) => widget.id === CORE_COST_OVERVIEW_WIDGET_ID
    );
    expect(cost).toBeDefined();
    expect(cost?.titleKey).toBe("workbench.widget.costOverview.title");
    expect(cost?.descriptionKey).toBe(
      "workbench.widget.costOverview.description"
    );
    expect(cost?.titleKey).not.toMatch(/^missionControl\./);
    expect(
      CORE_WORKBENCH_WIDGET_COMPONENTS.has(CORE_COST_OVERVIEW_WIDGET_ID)
    ).toBe(true);
  });
});
