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
} from "@/lib/plugins/panel-registry.ts";

describe("panel-registry dynamic merge", () => {
  afterEach(() => clearPluginPanelsForTests());

  it("includes core panels (terminal/welcome) always", () => {
    const components = getPanelComponents();
    expect(components.workbench).toBeUndefined();
    expect(components.terminal).toBeDefined();
    expect(components.welcome).toBeDefined();
  });

  it("resolves the Welcome panel kit metadata", () => {
    const components = getPanelComponents();

    expect({
      componentName: components.welcome?.displayName,
      icon: panelIconOf("welcome"),
      kind: panelKindOf("welcome"),
    }).toEqual({
      componentName: components.welcome?.displayName,
      icon: panelKits.welcome.icon,
      kind: panelKits.welcome.kind,
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
