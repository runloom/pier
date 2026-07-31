import {
  collectBundledPluginRegistrations,
  type OfficialBundledPluginSpec,
} from "@main/app-core/bundled-official-plugins.ts";
import type {
  BundledPluginBundle,
  ReadBundledPluginOptions,
} from "@main/app-core/bundled-plugin-reader.ts";
import { describe, expect, it } from "vitest";

const codexSpec: OfficialBundledPluginSpec = {
  devPackageDir: "packages/plugin-codex",
  fallbackId: "pier.codex",
  fallbackName: "Codex fallback",
  fallbackVersion: "1.0.0",
  id: "pier.codex",
  prodPluginDirName: "pier.codex",
};

const grokSpec: OfficialBundledPluginSpec = {
  devPackageDir: "packages/plugin-grok",
  fallbackId: "pier.grok",
  fallbackName: "Grok fallback",
  fallbackVersion: "2.0.0",
  id: "pier.grok",
  prodPluginDirName: "pier.grok",
};

function createFakeReader(
  bundlesByFallbackId: Readonly<Record<string, BundledPluginBundle | null>>
): {
  calls: ReadBundledPluginOptions[];
  readBundle: (options: ReadBundledPluginOptions) => BundledPluginBundle | null;
} {
  const calls: ReadBundledPluginOptions[] = [];
  return {
    calls,
    readBundle: (options) => {
      calls.push(options);
      return bundlesByFallbackId[options.fallbackId] ?? null;
    },
  };
}

describe("collectBundledPluginRegistrations", () => {
  it("keeps spec order and maps every field, including present falsy optionals", () => {
    const grokBundle: BundledPluginBundle = {
      archivePath: "/bundles/pier.grok-2.1.0.tgz",
      contributionCounts: {
        commands: 3,
        panels: 2,
        terminalStatusItems: 1,
        workbenchWidgets: 4,
      },
      description: "",
      locales: {
        "zh-CN": {
          description: "Grok 账号集成",
          name: "Grok",
        },
      },
      name: "Grok Account",
      sha256: "grok-sha256",
      size: 0,
      version: "2.1.0",
    };
    const codexBundle: BundledPluginBundle = {
      archivePath: "/bundles/pier.codex-1.2.0.tgz",
      contributionCounts: {
        commands: 1,
        panels: 0,
        terminalStatusItems: 2,
        workbenchWidgets: 3,
      },
      description: "Codex account integration",
      locales: {
        en: { name: "Codex Account" },
      },
      name: "Codex Account",
      sha256: "codex-sha256",
      size: 1024,
      version: "1.2.0",
    };
    const fake = createFakeReader({
      "pier.codex": codexBundle,
      "pier.grok": grokBundle,
    });

    const result = collectBundledPluginRegistrations(
      [grokSpec, codexSpec],
      fake.readBundle
    );

    expect(fake.calls).toEqual([
      {
        devPackageDir: grokSpec.devPackageDir,
        fallbackId: grokSpec.fallbackId,
        fallbackName: grokSpec.fallbackName,
        fallbackVersion: grokSpec.fallbackVersion,
        prodPluginDirName: grokSpec.prodPluginDirName,
      },
      {
        devPackageDir: codexSpec.devPackageDir,
        fallbackId: codexSpec.fallbackId,
        fallbackName: codexSpec.fallbackName,
        fallbackVersion: codexSpec.fallbackVersion,
        prodPluginDirName: codexSpec.prodPluginDirName,
      },
    ]);
    expect(result.registrations).toEqual([
      {
        archivePath: grokBundle.archivePath,
        contributionCounts: grokBundle.contributionCounts,
        description: grokBundle.description,
        displayName: grokBundle.name,
        id: grokSpec.id,
        locales: grokBundle.locales,
        sha256: grokBundle.sha256,
        size: grokBundle.size,
        version: grokBundle.version,
      },
      {
        archivePath: codexBundle.archivePath,
        contributionCounts: codexBundle.contributionCounts,
        description: codexBundle.description,
        displayName: codexBundle.name,
        id: codexSpec.id,
        locales: codexBundle.locales,
        sha256: codexBundle.sha256,
        size: codexBundle.size,
        version: codexBundle.version,
      },
    ]);
  });

  it("tracks present and missing bundles while omitting absent optional fields", () => {
    const codexBundle: BundledPluginBundle = {
      archivePath: "/bundles/pier.codex-1.0.0.tgz",
      contributionCounts: {
        commands: 0,
        panels: 0,
        terminalStatusItems: 0,
        workbenchWidgets: 0,
      },
      name: "Codex",
      sha256: "codex-sha256",
      version: "1.0.0",
    };
    const fake = createFakeReader({
      "pier.codex": codexBundle,
      "pier.grok": null,
    });

    const result = collectBundledPluginRegistrations(
      [grokSpec, codexSpec],
      fake.readBundle
    );

    expect([...result.availableById]).toEqual([
      [grokSpec.id, false],
      [codexSpec.id, true],
    ]);
    expect(result.registrations).toEqual([
      {
        archivePath: codexBundle.archivePath,
        contributionCounts: codexBundle.contributionCounts,
        displayName: codexBundle.name,
        id: codexSpec.id,
        sha256: codexBundle.sha256,
        version: codexBundle.version,
      },
    ]);
    expect(result.registrations[0]).not.toHaveProperty("description");
    expect(result.registrations[0]).not.toHaveProperty("locales");
    expect(result.registrations[0]).not.toHaveProperty("size");
  });
});
