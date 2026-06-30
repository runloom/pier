import { House } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearPluginPanelsForTests,
  getPluginPanelRegistrations,
  registerPluginPanel,
} from "@/lib/plugins/plugin-panel-registry.ts";

const reg = {
  component: () => null,
  icon: House,
  id: "pier.test.panel",
  kind: "web",
} as const;

describe("plugin-panel-registry", () => {
  afterEach(() => clearPluginPanelsForTests());

  it("registers and exposes a panel", () => {
    registerPluginPanel(reg);
    expect(getPluginPanelRegistrations().get("pier.test.panel")).toBe(reg);
  });

  it("dispose removes only its own registration", () => {
    const dispose = registerPluginPanel(reg);
    dispose();
    expect(getPluginPanelRegistrations().has("pier.test.panel")).toBe(false);
  });

  it("dispose does not remove a replaced registration", () => {
    const dispose = registerPluginPanel(reg);
    const replacement = { ...reg, icon: House };
    registerPluginPanel(replacement);
    dispose();
    expect(getPluginPanelRegistrations().get("pier.test.panel")).toBe(
      replacement
    );
  });
});
