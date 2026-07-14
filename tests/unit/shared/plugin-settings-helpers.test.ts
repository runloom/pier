import {
  type PluginConfigurationProperty,
  type PluginRegistryEntry,
  pluginConfigurationPropertySchema,
} from "@shared/contracts/plugin.ts";
import { pluginSettingsStateSchema } from "@shared/contracts/plugin-settings.ts";
import {
  collectEnabledConfigurationProperties,
  createConfigurationChangeEvent,
  diffConfigurationValues,
  effectiveConfigurationValue,
  matchesConfigurationPrefix,
  validateConfigurationValue,
} from "@shared/plugin-settings.ts";
import { describe, expect, it } from "vitest";

const boolProp: PluginConfigurationProperty = {
  default: true,
  type: "boolean",
};
const numProp: PluginConfigurationProperty = {
  default: 10,
  maximum: 100,
  minimum: 1,
  type: "number",
};
const enumProp: PluginConfigurationProperty = {
  default: "auto",
  enum: ["auto", "manual"],
  type: "string",
};

function entry(
  id: string,
  enabled: boolean,
  properties: Record<string, PluginConfigurationProperty>
): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      configuration: { properties },
      workbenchWidgets: [],
      settingsPages: [],
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  };
}

describe("pluginSettingsStateSchema", () => {
  it("接受空 values 并拒绝错误 version", () => {
    expect(
      pluginSettingsStateSchema.parse({ values: {}, version: 1 }).values
    ).toEqual({});
    expect(() =>
      pluginSettingsStateSchema.parse({ values: {}, version: 2 })
    ).toThrow();
  });
});

describe("matchesConfigurationPrefix — 点分段精确匹配", () => {
  it("pier.git 匹配 pier.git.* 与自身，不匹配 pier.gitx.*", () => {
    expect(matchesConfigurationPrefix("pier.git", "pier.git.a.b")).toBe(true);
    expect(matchesConfigurationPrefix("pier.git", "pier.git")).toBe(true);
    expect(matchesConfigurationPrefix("pier.git", "pier.gitx.a")).toBe(false);
  });
});

describe("validateConfigurationValue", () => {
  it("类型不匹配 / enum 越界 / min-max 越界 均拒绝", () => {
    expect(validateConfigurationValue(boolProp, "yes").ok).toBe(false);
    expect(validateConfigurationValue(enumProp, "off").ok).toBe(false);
    expect(validateConfigurationValue(numProp, 0).ok).toBe(false);
    expect(validateConfigurationValue(numProp, 101).ok).toBe(false);
    expect(validateConfigurationValue(numProp, Number.NaN).ok).toBe(false);
  });

  it("合法值通过", () => {
    expect(validateConfigurationValue(boolProp, false).ok).toBe(true);
    expect(validateConfigurationValue(enumProp, "manual").ok).toBe(true);
    expect(validateConfigurationValue(numProp, 100).ok).toBe(true);
  });
});

describe("pluginConfigurationPropertySchema", () => {
  it("允许 string multiline/placeholder,拒绝非 string multiline/placeholder", () => {
    expect(
      pluginConfigurationPropertySchema.parse({
        default: "",
        multiline: true,
        placeholder: "Prompt",
        type: "string",
      }).multiline
    ).toBe(true);
    expect(() =>
      pluginConfigurationPropertySchema.parse({
        default: true,
        multiline: true,
        type: "boolean",
      })
    ).toThrow();
    expect(() =>
      pluginConfigurationPropertySchema.parse({
        default: true,
        placeholder: "Prompt",
        type: "boolean",
      })
    ).toThrow();
  });
});

describe("effectiveConfigurationValue — 用户值 ?? default", () => {
  it("无用户值回落 default，非法存量值也回落 default", () => {
    expect(effectiveConfigurationValue(boolProp, undefined)).toBe(true);
    expect(effectiveConfigurationValue(boolProp, false)).toBe(false);
    expect(effectiveConfigurationValue(enumProp, "stale-value")).toBe("auto");
  });
});

describe("collectEnabledConfigurationProperties", () => {
  it("只收集已启用插件的声明", () => {
    const map = collectEnabledConfigurationProperties([
      entry("pier.a", true, { "pier.a.x": boolProp }),
      entry("pier.b", false, { "pier.b.y": boolProp }),
    ]);
    expect(map.has("pier.a.x")).toBe(true);
    expect(map.has("pier.b.y")).toBe(false);
  });
});

describe("createConfigurationChangeEvent", () => {
  it("affectsConfiguration 按点分段前缀匹配 changedKeys", () => {
    const event = createConfigurationChangeEvent([
      "pier.git.statusItem.showDirtyIndicator",
    ]);
    expect(event.affectsConfiguration("pier.git")).toBe(true);
    expect(event.affectsConfiguration("pier.git.statusItem")).toBe(true);
    expect(event.affectsConfiguration("pier.gitx")).toBe(false);
  });
});

describe("diffConfigurationValues", () => {
  it("新增/修改/删除的 key 全部计入", () => {
    expect(
      diffConfigurationValues(
        { a: 1, b: "x", c: true },
        { a: 2, b: "x" }
      ).sort()
    ).toEqual(["a", "c"]);
    expect(diffConfigurationValues({}, {})).toEqual([]);
  });
});
