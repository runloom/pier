import { managedPluginPackageManifestSchema } from "@shared/contracts/managed-plugin.ts";
import { pierCapabilitySchema } from "@shared/contracts/permissions.ts";
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";
import { pluginPermissions as englishPluginPermissions } from "@/i18n/locales/en/plugin-permissions.ts";
import { pluginPermissions as chinesePluginPermissions } from "@/i18n/locales/zh-CN/plugin-permissions.ts";

const removedTranscriptCapability = "transcript:read";

const builtinManifest = {
  apiVersion: 1,
  engines: { pier: ">=0.1.0" },
  id: "test.plugin",
  name: "Test Plugin",
  source: { kind: "builtin" },
  version: "1.0.0",
};

const managedManifest = {
  apiVersion: 1,
  engines: { pier: ">=0.1.0" },
  id: "test.plugin",
  main: "dist/main.js",
  name: "Test Plugin",
  renderer: "dist/renderer.js",
  version: "1.0.0",
};

describe("plugin permission contract", () => {
  it("不再公开会话记录读取能力", () => {
    expect(
      pierCapabilitySchema.safeParse(removedTranscriptCapability).success
    ).toBe(false);
    expect(
      Object.hasOwn(englishPluginPermissions, removedTranscriptCapability)
    ).toBe(false);
    expect(
      Object.hasOwn(chinesePluginPermissions, removedTranscriptCapability)
    ).toBe(false);
  });

  it.each([
    {
      label: "内置插件根权限",
      parse: (permission: string) =>
        pluginManifestSchema.safeParse({
          ...builtinManifest,
          permissions: [permission],
        }),
    },
    {
      label: "内置插件贡献权限",
      parse: (permission: string) =>
        pluginManifestSchema.safeParse({
          ...builtinManifest,
          commands: [
            {
              id: "test.plugin.command",
              permissions: [permission],
              title: "Test Command",
            },
          ],
        }),
    },
    {
      label: "受管理插件根权限",
      parse: (permission: string) =>
        managedPluginPackageManifestSchema.safeParse({
          ...managedManifest,
          permissions: [permission],
        }),
    },
    {
      label: "受管理插件贡献权限",
      parse: (permission: string) =>
        managedPluginPackageManifestSchema.safeParse({
          ...managedManifest,
          commands: [
            {
              id: "test.plugin.command",
              permissions: [permission],
              title: "Test Command",
            },
          ],
        }),
    },
  ])("$label 只拒绝已删除能力", ({ parse }) => {
    expect(parse("plugin:read").success).toBe(true);
    expect(parse(removedTranscriptCapability).success).toBe(false);
  });
});
