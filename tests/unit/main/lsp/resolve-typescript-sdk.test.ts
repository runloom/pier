import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createVueLspProvider } from "../../../../src/main/services/lsp/providers/config-language-providers.ts";
import {
  resolveTypescriptSdkLibForVue,
  resolveVueTypescriptPluginLocation,
} from "../../../../src/main/services/lsp/resolve-typescript-sdk.ts";

describe("resolveTypescriptSdkLibForVue", () => {
  it("falls back to Pier-bundled TypeScript 6 lib", () => {
    const lib = resolveTypescriptSdkLibForVue("/nonexistent-workspace-root");
    expect(lib).toBeTruthy();
    expect(lib).toMatch(/typescript[/\\]lib$/i);
  });

  it("prefers a workspace TypeScript ≤6 over the app fallback", () => {
    const root = mkdtempSync(join(tmpdir(), "pier-vue-tsdk-"));
    const pkgDir = join(root, "node_modules", "typescript");
    const libDir = join(pkgDir, "lib");
    mkdirSync(libDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "typescript", version: "5.9.2" })
    );
    writeFileSync(join(libDir, "typescript.js"), "module.exports = {};\n");

    const lib = resolveTypescriptSdkLibForVue(root);
    // macOS may resolve /var → /private/var; compare by suffix + realpath-ish endsWith.
    expect(lib?.replace(/\\/g, "/")).toMatch(
      /\/node_modules\/typescript\/lib$/
    );
    expect(lib?.includes("pier-vue-tsdk-")).toBe(true);
  });

  it("skips workspace TypeScript 7 and uses app fallback", () => {
    const root = mkdtempSync(join(tmpdir(), "pier-vue-tsdk7-"));
    const pkgDir = join(root, "node_modules", "typescript");
    const libDir = join(pkgDir, "lib");
    mkdirSync(libDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "typescript", version: "7.0.2" })
    );
    writeFileSync(join(libDir, "typescript.js"), "module.exports = {};\n");

    const lib = resolveTypescriptSdkLibForVue(root);
    expect(lib).toBeTruthy();
    expect(lib).not.toBe(libDir);
    expect(lib).toMatch(/typescript[/\\]lib$/i);
  });
});

describe("createVueLspProvider launch", () => {
  it("prefers bundled TLS + Vue typescript plugin when plugin is resolvable", async () => {
    const plugin = resolveVueTypescriptPluginLocation(process.cwd());
    const launch = await createVueLspProvider().resolveLaunch({
      rootPath: process.cwd(),
      workspaceKey: "main:test",
    });
    if (!launch) {
      return;
    }
    if (plugin) {
      expect(launch.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
      expect(launch.command).toBe(process.execPath);
      expect(launch.initializationOptions).toBeTruthy();
      const plugins = (
        launch.initializationOptions as {
          plugins?: Array<{ name?: string; location?: string }>;
        }
      ).plugins;
      expect(plugins?.[0]?.name).toBe("@vue/typescript-plugin");
      expect(plugins?.[0]?.location).toBeTruthy();
    } else {
      // Fallback path when plugin is not installed anywhere.
      const tsdkArg = launch.args.find((arg) =>
        String(arg).startsWith("--tsdk=")
      );
      expect(tsdkArg ?? launch.args.includes("--stdio")).toBeTruthy();
    }
  });
});
