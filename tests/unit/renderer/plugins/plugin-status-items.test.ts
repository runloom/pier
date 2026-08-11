import type { PluginRegistryDiagnostic } from "@shared/contracts/plugin.ts";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { buildPluginStatusItems } from "@/pages/settings/components/plugin-status-items.ts";

const t = ((key: string) => key) as unknown as TFunction;

function registryDiagnostic(
  partial: Pick<PluginRegistryDiagnostic, "code" | "message"> & {
    source?: PluginRegistryDiagnostic["source"];
  }
): PluginRegistryDiagnostic {
  return {
    code: partial.code,
    message: partial.message,
    source: partial.source ?? { kind: "local", path: "/tmp/plugin" },
  };
}

describe("buildPluginStatusItems", () => {
  it("returns empty when there is nothing to surface", () => {
    expect(
      buildPluginStatusItems({
        pageError: null,
        catalogError: null,
        diagnostics: [],
        runtimeDiagnostics: [],
        pluginMode: "release",
        t,
      })
    ).toEqual([]);
  });

  it("merges pageError and catalogError into one destructive item", () => {
    const items = buildPluginStatusItems({
      pageError: "page failed",
      catalogError: "catalog failed",
      diagnostics: [],
      runtimeDiagnostics: [],
      pluginMode: "release",
      t,
    });

    expect(items).toEqual([
      {
        id: "plugins-error",
        tone: "destructive",
        title: "settings.plugins.errorTitle",
        description: "page failed\ncatalog failed",
      },
    ]);
  });

  it("emits a single destructive item for pageError only", () => {
    const items = buildPluginStatusItems({
      pageError: "page failed",
      catalogError: null,
      diagnostics: [],
      runtimeDiagnostics: [],
      pluginMode: null,
      t,
    });

    expect(items).toEqual([
      {
        id: "plugins-error",
        tone: "destructive",
        title: "settings.plugins.errorTitle",
        description: "page failed",
      },
    ]);
  });

  it("emits a single destructive item for catalogError only", () => {
    const items = buildPluginStatusItems({
      pageError: null,
      catalogError: "catalog failed",
      diagnostics: [],
      runtimeDiagnostics: [],
      pluginMode: undefined,
      t,
    });

    expect(items).toEqual([
      {
        id: "plugins-error",
        tone: "destructive",
        title: "settings.plugins.errorTitle",
        description: "catalog failed",
      },
    ]);
  });

  it("maps a single diagnostic group to a warning with kind label title", () => {
    const items = buildPluginStatusItems({
      pageError: null,
      catalogError: null,
      diagnostics: [
        registryDiagnostic({
          code: "unsupported",
          message: "needs newer host",
        }),
      ],
      runtimeDiagnostics: [],
      pluginMode: "release",
      t,
    });

    expect(items).toEqual([
      {
        id: "plugins-diagnostics",
        tone: "warning",
        title: "settings.plugins.diagnostics.unsupported",
        description: "/tmp/plugin\nneeds newer host",
      },
    ]);
  });

  it("surfaces source path and parse detail for invalid_manifest", () => {
    const items = buildPluginStatusItems({
      pageError: null,
      catalogError: null,
      diagnostics: [
        registryDiagnostic({
          code: "invalid_manifest",
          message:
            "invalid plugin manifest (pier.files): configuration.properties.pier.files.editor.defaultLanguage.enumDescriptions: enumDescriptions must have the same length as enum",
          source: {
            kind: "builtin",
            path: "/app/src/plugins/builtin/files",
          },
        }),
      ],
      runtimeDiagnostics: [],
      pluginMode: "release",
      t,
    });

    expect(items).toEqual([
      {
        id: "plugins-diagnostics",
        tone: "warning",
        title: "settings.plugins.diagnostics.invalidManifest",
        description:
          "/app/src/plugins/builtin/files\ninvalid plugin manifest (pier.files): configuration.properties.pier.files.editor.defaultLanguage.enumDescriptions: enumDescriptions must have the same length as enum",
      },
    ]);
  });

  it("summarizes multiple diagnostic groups in one warning with multiline description", () => {
    const items = buildPluginStatusItems({
      pageError: null,
      catalogError: null,
      diagnostics: [
        registryDiagnostic({
          code: "invalid_manifest",
          message: "invalid plugin manifest (pier.files): id: too small",
          source: { kind: "builtin", path: "/app/files" },
        }),
        registryDiagnostic({
          code: "unsupported",
          message: "needs newer host",
        }),
      ],
      runtimeDiagnostics: [
        { pluginId: "pier.external", message: "renderer load timed out" },
      ],
      pluginMode: "release",
      t,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      id: "plugins-diagnostics",
      tone: "warning",
      title: "settings.plugins.diagnostics.summaryTitle",
      description: [
        "settings.plugins.diagnostics.invalidManifest: /app/files\ninvalid plugin manifest (pier.files): id: too small",
        "settings.plugins.diagnostics.unsupported: /tmp/plugin\nneeds newer host",
        "settings.plugins.diagnostics.runtime: pier.external\nrenderer load timed out",
      ].join("\n"),
    });
  });

  it("adds an info item when pluginMode is workspace", () => {
    const items = buildPluginStatusItems({
      pageError: null,
      catalogError: null,
      diagnostics: [],
      runtimeDiagnostics: [],
      pluginMode: "workspace",
      t,
    });

    expect(items).toEqual([
      {
        id: "plugins-workspace",
        tone: "info",
        title: "settings.plugins.pluginMode.workspaceTitle",
        description: "settings.plugins.pluginMode.workspaceBody",
      },
    ]);
  });

  it("stacks error, multi-diagnostic summary, and workspace info together", () => {
    const items = buildPluginStatusItems({
      pageError: "page failed",
      catalogError: null,
      diagnostics: [
        registryDiagnostic({
          code: "unsupported",
          message: "needs newer host",
        }),
      ],
      runtimeDiagnostics: [
        { pluginId: "pier.external", message: "renderer load timed out" },
      ],
      pluginMode: "workspace",
      t,
    });

    expect(items.map((item) => item.id)).toEqual([
      "plugins-error",
      "plugins-diagnostics",
      "plugins-workspace",
    ]);
    expect(items[1]?.title).toBe("settings.plugins.diagnostics.summaryTitle");
    expect(items[1]?.description).toBe(
      [
        "settings.plugins.diagnostics.unsupported: /tmp/plugin\nneeds newer host",
        "settings.plugins.diagnostics.runtime: pier.external\nrenderer load timed out",
      ].join("\n")
    );
  });
});
