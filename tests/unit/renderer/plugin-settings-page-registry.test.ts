import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExternalRendererPluginContext } from "@/lib/plugins/external-plugin-context.ts";
import {
  clearPluginSettingsPagesForTests,
  getPluginSettingsPage,
  registerPluginSettingsPage,
} from "@/lib/plugins/plugin-settings-page-registry.ts";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppAlert: vi.fn(async () => undefined),
  showAppChoice: vi.fn(async () => "cancel"),
  showAppConfirm: vi.fn(async () => true),
  showAppPrompt: vi.fn(async () => null),
}));

function demoEntry(
  settingsPages: PluginRegistryEntry["manifest"]["settingsPages"] = []
): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.demo",
      workbenchWidgets: [],
      name: "Demo",
      panels: [],
      permissions: [],
      settingsPages,
      source: { kind: "official" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "external" },
  };
}

describe("plugin settings page registry", () => {
  beforeEach(() => {
    clearPluginSettingsPagesForTests();
  });

  it("stores one page per plugin and dispose clears it", () => {
    const dispose = registerPluginSettingsPage("pier.demo", {
      id: "pier.demo.accounts",
      component: () => null,
    });
    expect(getPluginSettingsPage("pier.demo")?.id).toBe("pier.demo.accounts");
    dispose();
    expect(getPluginSettingsPage("pier.demo")).toBeUndefined();
  });
});

describe("createExternalRendererPluginContext settingsPages", () => {
  const bridge = {
    invoke: vi.fn(async () => ({ ok: true, data: null })),
    subscribe: vi.fn(() => () => undefined),
  };

  beforeEach(() => {
    clearPluginSettingsPagesForTests();
    vi.mocked(showAppConfirm).mockReset().mockResolvedValue(true);
    useSettingsDialogStore.setState({
      activeSection: "appearance",
      isOpen: false,
    });
  });

  it("throws when manifest did not declare settingsPages", () => {
    const context = createExternalRendererPluginContext(
      demoEntry(),
      bridge,
      () => []
    );
    expect(() =>
      context.settingsPages.register({
        id: "pier.demo.accounts",
        component: () => null,
      })
    ).toThrow(/undeclared settingsPage/);
  });

  it("throws when plugin already registered a settings page", () => {
    const entry = demoEntry([{ id: "pier.demo.accounts" }]);
    const context = createExternalRendererPluginContext(entry, bridge, () => [
      entry,
    ]);
    context.settingsPages.register({
      id: "pier.demo.accounts",
      component: () => null,
    });
    expect(() =>
      context.settingsPages.register({
        id: "pier.demo.accounts",
        component: () => null,
      })
    ).toThrow(/already registered/);
  });

  it("openSettings defaults to appearance section", () => {
    const context = createExternalRendererPluginContext(
      demoEntry(),
      bridge,
      () => []
    );
    context.app.openSettings();
    expect(useSettingsDialogStore.getState().isOpen).toBe(true);
    expect(useSettingsDialogStore.getState().activeSection).toBe("appearance");
  });

  it("openSettings accepts a plugin section id", () => {
    const context = createExternalRendererPluginContext(
      demoEntry(),
      bridge,
      () => []
    );
    context.app.openSettings({ section: "plugin:pier.codex" });
    expect(useSettingsDialogStore.getState().activeSection).toBe(
      "plugin:pier.codex"
    );
  });

  it("confirm forwards intent and size to showAppConfirm", async () => {
    const context = createExternalRendererPluginContext(
      demoEntry(),
      bridge,
      () => []
    );
    await context.dialogs.confirm({
      title: "Delete",
      intent: "destructive",
      size: "sm",
    });
    expect(showAppConfirm).toHaveBeenCalledWith({
      intent: "destructive",
      size: "sm",
      title: "Delete",
    });
  });
});
