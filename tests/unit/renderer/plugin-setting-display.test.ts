import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";
import {
  defaultPluginSettingLabel,
  resolvePluginConfigurationTitle,
  resolvePluginSettingDisplay,
} from "@/lib/plugins/display.ts";

function entryWith(overrides: {
  configurationTitle?: string;
  locales?: PluginRegistryEntry["manifest"]["locales"];
}): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      configuration: {
        properties: {
          "pier.git.statusItem.showDirtyIndicator": {
            default: true,
            description: "Manifest fallback description.",
            type: "boolean",
          },
          "pier.git.statusItem.mode": {
            default: "auto",
            enum: ["auto", "manual"],
            enumDescriptions: ["Auto (manifest)", "Manual (manifest)"],
            type: "string",
          },
        },
        ...(overrides.configurationTitle
          ? { title: overrides.configurationTitle }
          : {}),
      },
      engines: { pier: ">=0.1.0" },
      id: "pier.git",
      ...(overrides.locales ? { locales: overrides.locales } : {}),
      localization: {
        defaultLocale: "en",
        files: {},
        locales: ["en", "zh-CN"],
      },
      name: "Git",
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

describe("defaultPluginSettingLabel", () => {
  it("label 缺省 = 去掉插件前缀后的全部剩余段", () => {
    expect(
      defaultPluginSettingLabel(
        "pier.git",
        "pier.git.statusItem.showDirtyIndicator"
      )
    ).toBe("statusItem.showDirtyIndicator");
    expect(defaultPluginSettingLabel("pier.git", "other.key")).toBe(
      "other.key"
    );
  });
});

describe("resolvePluginSettingDisplay", () => {
  it("locale settings 段优先，缺失回落 manifest description 与默认 label", () => {
    const entry = entryWith({
      locales: {
        "zh-CN": {
          settings: {
            "pier.git.statusItem.showDirtyIndicator": {
              description: "在状态项中显示变更计数。",
              label: "显示变更指示",
            },
          },
        },
      },
    });
    const zh = resolvePluginSettingDisplay(
      entry.manifest,
      "pier.git.statusItem.showDirtyIndicator",
      "zh-CN"
    );
    expect(zh).toEqual({
      description: "在状态项中显示变更计数。",
      label: "显示变更指示",
    });

    const en = resolvePluginSettingDisplay(
      entry.manifest,
      "pier.git.statusItem.showDirtyIndicator",
      "en"
    );
    expect(en.label).toBe("statusItem.showDirtyIndicator");
    expect(en.description).toBe("Manifest fallback description.");
  });

  it("enumDescriptions locale 覆盖回落 manifest", () => {
    const entry = entryWith({
      locales: {
        "zh-CN": {
          settings: {
            "pier.git.statusItem.mode": {
              enumDescriptions: ["自动", "手动"],
            },
          },
        },
      },
    });
    expect(
      resolvePluginSettingDisplay(
        entry.manifest,
        "pier.git.statusItem.mode",
        "zh-CN"
      ).enumDescriptions
    ).toEqual(["自动", "手动"]);
    expect(
      resolvePluginSettingDisplay(
        entry.manifest,
        "pier.git.statusItem.mode",
        "en"
      ).enumDescriptions
    ).toEqual(["Auto (manifest)", "Manual (manifest)"]);
  });
});

describe("resolvePluginConfigurationTitle", () => {
  it("configuration.title 优先，缺省回落插件显示名", () => {
    expect(
      resolvePluginConfigurationTitle(
        entryWith({ configurationTitle: "Git Settings" }),
        "en"
      )
    ).toBe("Git Settings");
    expect(resolvePluginConfigurationTitle(entryWith({}), "en")).toBe("Git");
  });
});
