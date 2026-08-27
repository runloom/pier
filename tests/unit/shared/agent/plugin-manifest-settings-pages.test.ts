import { managedPluginPackageManifestSchema } from "@shared/contracts/plugin/managed.ts";
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

describe("projectSettings contribution", () => {
  it("accepts project settings on package and runtime manifests", () => {
    const parsed = managedPluginPackageManifestSchema.parse({
      ...basePackage,
      projectSettings: [{ id: "pier.demo.project" }],
    });
    expect(parsed.projectSettings).toEqual([{ id: "pier.demo.project" }]);
    const runtime = pluginManifestSchema.parse({
      apiVersion: 1,
      engines: { pier: ">=0.1.0" },
      id: "pier.demo",
      name: "Demo",
      projectSettings: [{ id: "pier.demo.project" }],
      source: { kind: "official" },
      version: "1.0.0",
    });
    expect(runtime.projectSettings).toEqual([{ id: "pier.demo.project" }]);
  });

  it("rejects projectSettings ids without plugin prefix", () => {
    expect(() =>
      pluginManifestSchema.parse({
        apiVersion: 1,
        engines: { pier: ">=0.1.0" },
        id: "pier.demo",
        name: "Demo",
        projectSettings: [{ id: "wrong" }],
        source: { kind: "official" },
        version: "1.0.0",
      })
    ).toThrow(/projectSettings id must start with/);
  });
});
