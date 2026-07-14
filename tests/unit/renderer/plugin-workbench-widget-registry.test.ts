import { House } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearPluginWorkbenchWidgetsForTests,
  getPluginWorkbenchWidgetRegistrations,
  getPluginWorkbenchWidgetRevision,
  registerPluginWorkbenchWidget,
  subscribePluginWorkbenchWidgetRegistry,
} from "@/lib/plugins/plugin-workbench-widget-registry.ts";

const reg = {
  component: () => null,
  icon: House,
  id: "pier.test.widget",
} as const;

describe("plugin-workbench-widget-registry", () => {
  afterEach(() => clearPluginWorkbenchWidgetsForTests());

  it("registers and exposes a widget", () => {
    registerPluginWorkbenchWidget(reg);
    expect(
      getPluginWorkbenchWidgetRegistrations().get("pier.test.widget")
    ).toBe(reg);
  });

  it("dispose removes only its own registration", () => {
    const dispose = registerPluginWorkbenchWidget(reg);
    dispose();
    expect(
      getPluginWorkbenchWidgetRegistrations().has("pier.test.widget")
    ).toBe(false);
  });

  it("rejects a duplicate registration without changing the owner", () => {
    const dispose = registerPluginWorkbenchWidget(reg);
    const replacement = { ...reg, icon: House };

    expect(() => registerPluginWorkbenchWidget(replacement)).toThrow(
      "workbench widget id is already registered"
    );
    expect(
      getPluginWorkbenchWidgetRegistrations().get("pier.test.widget")
    ).toBe(reg);
    dispose();
  });

  it("increments revision on register and dispose", () => {
    const r0 = getPluginWorkbenchWidgetRevision();
    const dispose = registerPluginWorkbenchWidget(reg);
    expect(getPluginWorkbenchWidgetRevision()).toBe(r0 + 1);
    dispose();
    expect(getPluginWorkbenchWidgetRevision()).toBe(r0 + 2);
  });

  it("rejects core-owned widget ids", () => {
    expect(() =>
      registerPluginWorkbenchWidget({ ...reg, id: "core.custom-card" })
    ).toThrow("workbench widget id is reserved by core");
  });

  it("notifies subscribers on changes", () => {
    let callCount = 0;
    const unsubscribe = subscribePluginWorkbenchWidgetRegistry(() => {
      callCount += 1;
    });
    registerPluginWorkbenchWidget(reg);
    expect(callCount).toBe(1);
    unsubscribe();
    registerPluginWorkbenchWidget({ ...reg, id: "pier.other" });
    expect(callCount).toBe(1); // unsubscribed, no increment
  });
});
