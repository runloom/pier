import { managedPluginPackageManifestSchema } from "@shared/contracts/managed-plugin.ts";
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";

const basePackage = {
  apiVersion: 1 as const,
  id: "pier.demo",
  name: "Demo",
  version: "1.0.0",
  engines: { pier: ">=0.1.0 <0.2.0" },
  main: "dist/main.js",
  renderer: "dist/renderer.js",
};

describe("settingsPages contribution", () => {
  it("accepts a single settings page on package manifest", () => {
    const parsed = managedPluginPackageManifestSchema.parse({
      ...basePackage,
      settingsPages: [{ id: "pier.demo.accounts" }],
    });
    expect(parsed.settingsPages).toEqual([{ id: "pier.demo.accounts" }]);
  });

  it("rejects more than one settings page", () => {
    expect(() =>
      managedPluginPackageManifestSchema.parse({
        ...basePackage,
        settingsPages: [{ id: "a" }, { id: "b" }],
      })
    ).toThrow();
  });

  it("defaults settingsPages to [] on runtime manifest", () => {
    const parsed = pluginManifestSchema.parse({
      apiVersion: 1,
      id: "pier.demo",
      name: "Demo",
      version: "1.0.0",
      engines: { pier: ">=0.1.0" },
      source: { kind: "official" },
    });
    expect(parsed.settingsPages).toEqual([]);
  });
});
