import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";
import {
  pluginNavItems,
  pluginSectionId,
} from "@/pages/settings/data/appearance-nav.ts";

function entry(
  id: string,
  options: {
    configured?: boolean;
    enabled?: boolean;
    settingsPages?: boolean;
  } = {}
): PluginRegistryEntry {
  const { configured = true, enabled = true, settingsPages = false } = options;

  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      engines: { pier: ">=0.1.0" },
      id,
      missionControlWidgets: [],
      name: `${id}-name`,
      panels: [],
      permissions: [],
      settingsPages: settingsPages ? [{ id: `${id}.page` }] : [],
      ...(configured
        ? {
            configuration: {
              properties: {
                [`${id}.flag`]: { default: true, type: "boolean" },
              },
              title: `${id} Settings`,
            },
          }
        : {}),
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  };
}

describe("pluginNavItems", () => {
  it("includes enabled plugins that declare configuration", () => {
    const items = pluginNavItems([entry("pier.configured")], "en");
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(pluginSectionId("pier.configured"));
    expect(items[0]?.pluginId).toBe("pier.configured");
  });

  it("includes enabled plugins that only declare settingsPages", () => {
    const items = pluginNavItems(
      [entry("pier.only-page", { configured: false, settingsPages: true })],
      "en"
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("plugin:pier.only-page");
  });

  it("excludes disabled plugins even when they declare configuration", () => {
    const items = pluginNavItems(
      [entry("pier.disabled", { enabled: false })],
      "en"
    );
    expect(items).toHaveLength(0);
  });

  it("excludes plugins with neither configuration nor settingsPages", () => {
    const items = pluginNavItems(
      [entry("pier.empty", { configured: false })],
      "en"
    );
    expect(items).toHaveLength(0);
  });
});
