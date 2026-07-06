import { House } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearPluginDashboardWidgetsForTests,
  getPluginDashboardWidgetRegistrations,
  getPluginDashboardWidgetRevision,
  registerPluginDashboardWidget,
  subscribePluginDashboardWidgetRegistry,
} from "@/lib/plugins/plugin-dashboard-widget-registry.ts";

const reg = {
  component: () => null,
  icon: House,
  id: "pier.test.widget",
} as const;

describe("plugin-dashboard-widget-registry", () => {
  afterEach(() => clearPluginDashboardWidgetsForTests());

  it("registers and exposes a widget", () => {
    registerPluginDashboardWidget(reg);
    expect(
      getPluginDashboardWidgetRegistrations().get("pier.test.widget")
    ).toBe(reg);
  });

  it("dispose removes only its own registration", () => {
    const dispose = registerPluginDashboardWidget(reg);
    dispose();
    expect(
      getPluginDashboardWidgetRegistrations().has("pier.test.widget")
    ).toBe(false);
  });

  it("dispose does not remove a replaced registration", () => {
    const dispose = registerPluginDashboardWidget(reg);
    const replacement = { ...reg, icon: House };
    registerPluginDashboardWidget(replacement);
    dispose();
    expect(
      getPluginDashboardWidgetRegistrations().get("pier.test.widget")
    ).toBe(replacement);
  });

  it("increments revision on register and dispose", () => {
    const r0 = getPluginDashboardWidgetRevision();
    const dispose = registerPluginDashboardWidget(reg);
    expect(getPluginDashboardWidgetRevision()).toBe(r0 + 1);
    dispose();
    expect(getPluginDashboardWidgetRevision()).toBe(r0 + 2);
  });

  it("notifies subscribers on changes", () => {
    let callCount = 0;
    const unsubscribe = subscribePluginDashboardWidgetRegistry(() => {
      callCount += 1;
    });
    registerPluginDashboardWidget(reg);
    expect(callCount).toBe(1);
    unsubscribe();
    registerPluginDashboardWidget({ ...reg, id: "pier.other" });
    expect(callCount).toBe(1); // unsubscribed, no increment
  });
});
