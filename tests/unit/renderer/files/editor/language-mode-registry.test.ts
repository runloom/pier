import { LanguageSupport } from "@codemirror/language";
import { cmLanguageExtension } from "@plugins/builtin/files/renderer/editor/cm-language.ts";
import { languageForPath } from "@plugins/builtin/files/renderer/editor/language-detection.ts";
import { editorLanguageModeRegistry } from "@plugins/builtin/files/renderer/editor/language-mode-registry.ts";
import {
  modesFromCustomServers,
  modesFromPluginRegistry,
  syncEditorLanguageModes,
} from "@plugins/builtin/files/renderer/editor/sync-language-modes.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { beforeEach, describe, expect, it } from "vitest";

function pluginEntry(
  partial: Partial<PluginRegistryEntry> & {
    manifest: PluginRegistryEntry["manifest"];
  }
): PluginRegistryEntry {
  return {
    runtime: {
      enabled: true,
      kind: "builtin",
      updatedAt: 0,
    },
    ...partial,
  } as PluginRegistryEntry;
}

describe("editor language mode registry", () => {
  beforeEach(() => {
    editorLanguageModeRegistry.clear();
  });

  it("maps plugin languageModes extensions after L0 builtins", () => {
    syncEditorLanguageModes({
      plugins: [
        pluginEntry({
          manifest: {
            apiVersion: 1,
            commands: [],
            engines: { pier: ">=0.1.0" },
            id: "pier.lsp-zig",
            languageModes: [
              {
                displayName: "Zig",
                extensions: [".zig"],
                highlight: "clike",
                id: "zig",
                languageId: "zig",
                priority: 70,
              },
            ],
            name: "Zig",
            panels: [],
            permissions: ["languageMode:provide"],
            settingsPages: [],
            source: { kind: "builtin" },
            terminalStatusItems: [],
            version: "0.1.0",
            workbenchWidgets: [],
          },
        }),
      ],
    });

    expect(languageForPath("src/main.zig")).toBe("zig");
    expect(languageForPath("src/main.ts")).toBe("typescript");
    const extension = cmLanguageExtension("zig");
    expect(extension).toBeTruthy();
  });

  it("maps L1 custom servers to display modes with highlight preset", () => {
    const modes = modesFromCustomServers([
      {
        args: ["--stdio"],
        command: "zls",
        displayName: "Zig",
        extensions: [".zig"],
        highlightPreset: "clike",
        id: "zls",
        languageIds: ["zig"],
        priority: 50,
        rootMarkers: ["build.zig"],
      },
    ]);
    editorLanguageModeRegistry.replaceCustomModes(modes);
    expect(languageForPath("lib/foo.zig")).toBe("zig");
    expect(editorLanguageModeRegistry.labelForLanguageId("zig")).toBe("Zig");
  });

  it("ignores plugin modes without languageMode:provide", () => {
    const modes = modesFromPluginRegistry([
      pluginEntry({
        manifest: {
          apiVersion: 1,
          commands: [],
          engines: { pier: ">=0.1.0" },
          id: "pier.bad",
          languageModes: [
            {
              displayName: "X",
              extensions: [".xlang"],
              highlight: "text",
              id: "xlang",
              priority: 70,
            },
          ],
          name: "Bad",
          panels: [],
          permissions: ["lsp:provide"],
          settingsPages: [],
          source: { kind: "builtin" },
          terminalStatusItems: [],
          version: "0.1.0",
          workbenchWidgets: [],
        },
      }),
    ]);
    expect(modes).toEqual([]);
  });

  it("does not override L0 extension maps with lower-priority modes", () => {
    syncEditorLanguageModes({
      plugins: [
        pluginEntry({
          manifest: {
            apiVersion: 1,
            commands: [],
            engines: { pier: ">=0.1.0" },
            id: "pier.fake-ts",
            languageModes: [
              {
                displayName: "Fake TS",
                extensions: [".ts"],
                highlight: "text",
                id: "fake",
                languageId: "fake",
                priority: 99,
              },
            ],
            name: "Fake",
            panels: [],
            permissions: ["languageMode:provide"],
            settingsPages: [],
            source: { kind: "builtin" },
            terminalStatusItems: [],
            version: "0.1.0",
            workbenchWidgets: [],
          },
        }),
      ],
    });
    expect(languageForPath("a.ts")).toBe("typescript");
  });
});

describe("cmExtensionForHighlightPreset via zig", () => {
  it("returns a language support for clike preset", () => {
    editorLanguageModeRegistry.replaceCustomModes([
      {
        displayName: "Zig",
        extensions: [".zig"],
        highlight: "clike",
        languageId: "zig",
        priority: 50,
        source: "custom",
        sourceId: "custom:zls",
      },
    ]);
    const extension = cmLanguageExtension("zig");
    // StreamLanguage for clike
    expect(extension).not.toBeNull();
    expect(extension).not.toBeInstanceOf(LanguageSupport);
  });
});
