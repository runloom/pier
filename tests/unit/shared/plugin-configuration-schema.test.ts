import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";

function manifestWith(configuration?: unknown): unknown {
  return {
    apiVersion: 1,
    engines: { pier: ">=0.1.0" },
    id: "pier.sample",
    name: "Sample",
    source: { kind: "builtin" },
    version: "1.0.0",
    ...(configuration === undefined ? {} : { configuration }),
  };
}

function propertiesWith(properties: Record<string, unknown>): unknown {
  return { properties };
}

describe("pluginManifestSchema — configuration", () => {
  it("接受省略 configuration 的 manifest（向后兼容）", () => {
    expect(
      pluginManifestSchema.parse(manifestWith()).configuration
    ).toBeUndefined();
  });

  it("接受合法的 boolean/number/string-enum 声明", () => {
    const parsed = pluginManifestSchema.parse(
      manifestWith({
        properties: {
          "pier.sample.enabled": { default: true, type: "boolean" },
          "pier.sample.limit": {
            default: 10,
            maximum: 100,
            minimum: 1,
            order: 2,
            type: "number",
          },
          "pier.sample.mode": {
            default: "auto",
            description: "Mode of operation.",
            enum: ["auto", "manual"],
            enumDescriptions: ["Automatic", "Manual"],
            type: "string",
          },
        },
        title: "Sample",
      })
    );
    expect(parsed.configuration?.title).toBe("Sample");
    expect(parsed.configuration?.properties["pier.sample.mode"]?.enum).toEqual([
      "auto",
      "manual",
    ]);
  });

  it("拒绝 default 类型与 type 不匹配", () => {
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith(
          propertiesWith({
            "pier.sample.enabled": { default: "yes", type: "boolean" },
          })
        )
      )
    ).toThrow();
  });

  it("拒绝 enum 配非 string 类型", () => {
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith(
          propertiesWith({
            "pier.sample.limit": {
              default: 1,
              enum: ["1", "2"],
              type: "number",
            },
          })
        )
      )
    ).toThrow();
  });

  it("拒绝 default 不在 enum 内", () => {
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith(
          propertiesWith({
            "pier.sample.mode": {
              default: "off",
              enum: ["auto", "manual"],
              type: "string",
            },
          })
        )
      )
    ).toThrow();
  });

  it("拒绝 enumDescriptions 与 enum 不等长或无 enum 的 enumDescriptions", () => {
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith(
          propertiesWith({
            "pier.sample.mode": {
              default: "auto",
              enum: ["auto", "manual"],
              enumDescriptions: ["only-one"],
              type: "string",
            },
          })
        )
      )
    ).toThrow();
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith(
          propertiesWith({
            "pier.sample.mode": {
              default: "auto",
              enumDescriptions: ["dangling"],
              type: "string",
            },
          })
        )
      )
    ).toThrow();
  });

  it("拒绝 minimum/maximum 配非 number 类型", () => {
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith(
          propertiesWith({
            "pier.sample.mode": { default: "a", minimum: 1, type: "string" },
          })
        )
      )
    ).toThrow();
  });

  it("拒绝设置 key 不带 <pluginId>. 前缀（顶层 superRefine）", () => {
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith(
          propertiesWith({
            "other.enabled": { default: true, type: "boolean" },
          })
        )
      )
    ).toThrow();
    // key 恰好等于 pluginId 也不合法（前缀后必须还有剩余段）
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith(
          propertiesWith({
            "pier.sample": { default: true, type: "boolean" },
          })
        )
      )
    ).toThrow();
  });
});
