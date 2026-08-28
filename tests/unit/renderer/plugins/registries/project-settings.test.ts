import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { beforeEach, describe, expect, it } from "vitest";
import { assertDeclaredContribution } from "@/lib/plugins/host/assert-contribution.ts";
import { createPluginProjectSettingsContext } from "@/lib/plugins/host/project-settings-context.ts";
import {
  clearPluginProjectSettingsForTests,
  getPluginProjectSettingsRegistrations,
  registerPluginProjectSettings,
} from "@/lib/plugins/project-settings-registry.ts";

function demoEntry(
  projectSettings: PluginRegistryEntry["manifest"]["projectSettings"] = []
): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      canvasActions: [],
      dataProjections: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.demo",
      name: "Demo",
      panels: [],
      permissions: [],
      projectSettings,
      settingsPages: [],
      source: { kind: "official" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "external" },
  };
}

describe("plugin project settings registry", () => {
  beforeEach(() => {
    clearPluginProjectSettingsForTests();
  });

  it("stores registrations and dispose clears them", () => {
    const dispose = registerPluginProjectSettings({
      id: "pier.demo.project",
      render: () => null,
      title: () => "Memory",
    });
    expect(getPluginProjectSettingsRegistrations()).toHaveLength(1);
    dispose();
    expect(getPluginProjectSettingsRegistrations()).toHaveLength(0);
  });

  it("rejects duplicate ids", () => {
    registerPluginProjectSettings({
      id: "pier.demo.project",
      render: () => null,
      title: () => "Memory",
    });
    expect(() =>
      registerPluginProjectSettings({
        id: "pier.demo.project",
        render: () => null,
        title: () => "Other",
      })
    ).toThrow(/already registered/);
  });
});

describe("createPluginProjectSettingsContext", () => {
  beforeEach(() => {
    clearPluginProjectSettingsForTests();
  });

  it("throws when manifest did not declare projectSettings", () => {
    const context = createPluginProjectSettingsContext(
      demoEntry(),
      assertDeclaredContribution
    );
    expect(() =>
      context.register({
        id: "pier.demo.project",
        render: () => null,
        title: () => "Memory",
      })
    ).toThrow(/plugin contribution not declared/);
  });

  it("registers when the contribution is declared", () => {
    const context = createPluginProjectSettingsContext(
      demoEntry([{ id: "pier.demo.project" }]),
      assertDeclaredContribution
    );
    context.register({
      id: "pier.demo.project",
      render: () => null,
      title: () => "Memory",
    });
    expect(getPluginProjectSettingsRegistrations()[0]?.id).toBe(
      "pier.demo.project"
    );
  });
});
