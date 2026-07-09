import { House } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearPluginMissionControlWidgetsForTests,
  getPluginMissionControlWidgetRegistrations,
  getPluginMissionControlWidgetRevision,
  registerPluginMissionControlWidget,
  subscribePluginMissionControlWidgetRegistry,
} from "@/lib/plugins/plugin-mission-control-widget-registry.ts";

const reg = {
  component: () => null,
  icon: House,
  id: "pier.test.widget",
} as const;

describe("plugin-mission-control-widget-registry", () => {
  afterEach(() => clearPluginMissionControlWidgetsForTests());

  it("registers and exposes a widget", () => {
    registerPluginMissionControlWidget(reg);
    expect(
      getPluginMissionControlWidgetRegistrations().get("pier.test.widget")
    ).toBe(reg);
  });

  it("dispose removes only its own registration", () => {
    const dispose = registerPluginMissionControlWidget(reg);
    dispose();
    expect(
      getPluginMissionControlWidgetRegistrations().has("pier.test.widget")
    ).toBe(false);
  });

  it("dispose does not remove a replaced registration", () => {
    const dispose = registerPluginMissionControlWidget(reg);
    const replacement = { ...reg, icon: House };
    registerPluginMissionControlWidget(replacement);
    dispose();
    expect(
      getPluginMissionControlWidgetRegistrations().get("pier.test.widget")
    ).toBe(replacement);
  });

  it("increments revision on register and dispose", () => {
    const r0 = getPluginMissionControlWidgetRevision();
    const dispose = registerPluginMissionControlWidget(reg);
    expect(getPluginMissionControlWidgetRevision()).toBe(r0 + 1);
    dispose();
    expect(getPluginMissionControlWidgetRevision()).toBe(r0 + 2);
  });

  it("notifies subscribers on changes", () => {
    let callCount = 0;
    const unsubscribe = subscribePluginMissionControlWidgetRegistry(() => {
      callCount += 1;
    });
    registerPluginMissionControlWidget(reg);
    expect(callCount).toBe(1);
    unsubscribe();
    registerPluginMissionControlWidget({ ...reg, id: "pier.other" });
    expect(callCount).toBe(1); // unsubscribed, no increment
  });
});
