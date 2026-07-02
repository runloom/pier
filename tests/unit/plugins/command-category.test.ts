import {
  type PluginManifest,
  pluginLocaleMessagesSchema,
  pluginManifestSchema,
} from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";
import { resolvePluginCommandDisplay } from "@/lib/plugins/display.ts";

const COMMAND_ID = "pier.test.cmd";

function makeManifest(): PluginManifest {
  return pluginManifestSchema.parse({
    apiVersion: 1,
    commands: [{ category: "Fallback", id: COMMAND_ID, title: "Cmd" }],
    engines: { pier: ">=0.1.0" },
    id: "pier.test",
    locales: {
      "zh-CN": {
        commands: {
          [COMMAND_ID]: { category: "分类", title: "命令" },
        },
      },
    },
    name: "Test",
    source: { kind: "builtin" },
    version: "1.0.0",
  });
}

describe("plugin command category i18n", () => {
  it("accepts category in locale command entries", () => {
    const parsed = pluginLocaleMessagesSchema.parse({
      commands: { [COMMAND_ID]: { category: "Git", title: "T" } },
    });
    expect(parsed.commands?.[COMMAND_ID]?.category).toBe("Git");
  });

  it("rejects empty category strings", () => {
    const result = pluginLocaleMessagesSchema.safeParse({
      commands: { [COMMAND_ID]: { category: "", title: "T" } },
    });
    expect(result.success).toBe(false);
  });

  it("resolves category from the active locale", () => {
    const manifest = makeManifest();
    const command = manifest.commands[0];
    expect(command).toBeDefined();
    if (!command) {
      return;
    }
    const display = resolvePluginCommandDisplay(manifest, command, "zh-CN");
    expect(display.category).toBe("分类");
    expect(display.title).toBe("命令");
  });

  it("falls back to the manifest category when the locale has none", () => {
    const manifest = makeManifest();
    const command = manifest.commands[0];
    expect(command).toBeDefined();
    if (!command) {
      return;
    }
    const display = resolvePluginCommandDisplay(manifest, command, "en");
    expect(display.category).toBe("Fallback");
  });

  it("omits category when neither locale nor manifest declares one", () => {
    const manifest = pluginManifestSchema.parse({
      apiVersion: 1,
      commands: [{ id: COMMAND_ID, title: "Cmd" }],
      engines: { pier: ">=0.1.0" },
      id: "pier.test",
      name: "Test",
      source: { kind: "builtin" },
      version: "1.0.0",
    });
    const command = manifest.commands[0];
    expect(command).toBeDefined();
    if (!command) {
      return;
    }
    const display = resolvePluginCommandDisplay(manifest, command, "en");
    expect(display.category).toBeUndefined();
  });
});
