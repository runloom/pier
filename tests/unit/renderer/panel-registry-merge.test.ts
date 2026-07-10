import { House } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import {
  getPanelComponents,
  panelIconOf,
  panelKindOf,
  panelKits,
} from "@/components/workspace/panel-registry.ts";
import {
  clearPluginPanelsForTests,
  registerPluginPanel,
} from "@/lib/plugins/plugin-panel-registry.ts";

describe("panel-registry dynamic merge", () => {
  afterEach(() => clearPluginPanelsForTests());

  it("includes core panels (terminal/welcome) always", () => {
    const components = getPanelComponents();
    expect(components.terminal).toBeDefined();
    expect(components.welcome).toBeDefined();
  });

  it("resolves the dashboard alias through the Mission Control panel kit", () => {
    const components = getPanelComponents();

    expect({
      componentName: components.dashboard?.displayName,
      icon: panelIconOf("dashboard"),
      kind: panelKindOf("dashboard"),
    }).toEqual({
      componentName: components["mission-control"]?.displayName,
      icon: panelKits["mission-control"].icon,
      kind: panelKits["mission-control"].kind,
    });
  });

  it("merges plugin-registered panels", () => {
    registerPluginPanel({
      component: () => null,
      icon: House,
      id: "pier.test.panel",
      kind: "web",
    });
    expect(getPanelComponents()["pier.test.panel"]).toBeDefined();
    expect(panelKindOf("pier.test.panel")).toBe("web");
    expect(panelIconOf("pier.test.panel")).toBe(House);
  });

  it("core panel kind/icon takes precedence and unknown falls back to web", () => {
    expect(panelKindOf("terminal")).toBe("terminal");
    expect(panelKindOf("nonexistent")).toBe("web");
  });
});
