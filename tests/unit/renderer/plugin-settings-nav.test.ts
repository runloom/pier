import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";
import {
  NAV_ITEMS,
  pluginIdFromSectionId,
  pluginNavItems,
  pluginSectionId,
} from "@/pages/settings/data/appearance-nav.ts";

function entry(
  id: string,
  opts: { configured?: boolean; enabled?: boolean; title?: string } = {}
): PluginRegistryEntry {
  const { configured = true, enabled = true, title } = opts;
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      ...(configured
        ? {
            configuration: {
              properties: {
                [`${id}.enabled`]: { default: true, type: "boolean" },
              },
              ...(title ? { title } : {}),
            },
          }
        : {}),
      engines: { pier: ">=0.1.0" },
      id,
      name: `${id}-name`,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  };
}

describe("settings 导航 — 插件项 variant", () => {
  it("静态项全部是 static variant 且不含硬编码 label", () => {
    expect(NAV_ITEMS.every((item) => item.variant === "static")).toBe(true);
    expect(NAV_ITEMS.some((item) => "label" in item)).toBe(false);
  });

  it("插件项只收已启用且声明 configuration 的插件", () => {
    const items = pluginNavItems(
      [
        entry("pier.a", { title: "A Settings" }),
        entry("pier.b", { enabled: false }),
        entry("pier.c", { configured: false }),
      ],
      "en"
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "plugin:pier.a",
      label: "A Settings",
      pluginId: "pier.a",
      variant: "plugin",
    });
  });

  it("configuration.title 缺省回落插件显示名", () => {
    expect(pluginNavItems([entry("pier.a")], "en")[0]?.label).toBe(
      "pier.a-name"
    );
  });

  it("section id 与 pluginId 双向换算", () => {
    expect(pluginSectionId("pier.git")).toBe("plugin:pier.git");
    expect(pluginIdFromSectionId("plugin:pier.git")).toBe("pier.git");
    expect(pluginIdFromSectionId("plugins")).toBeNull();
  });
});
