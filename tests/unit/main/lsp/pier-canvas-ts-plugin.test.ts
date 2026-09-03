import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  PIER_CANVAS_TS_PLUGIN_NAME,
  resolvePierCanvasTsPlugin,
  resourcesRootForLspPlugins,
} from "@main/services/lsp/pier-canvas-ts-plugin.ts";
import { createTypescriptLspProvider } from "@main/services/lsp/providers/typescript-provider.ts";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const plugin =
  require("../../../../resources/lsp-plugins/node_modules/pier-canvas-modules/index.cjs") as {
    overridePath: (specifier: string, hadResolved: boolean) => string | null;
    sdkDir: string;
  };

describe("pier-canvas tsserver plugin", () => {
  it("resolves the bundled plugin next to system-skills in extraResources layout", () => {
    const resolved = resolvePierCanvasTsPlugin();
    expect(resolved).not.toBeNull();
    expect(resolved?.name).toBe(PIER_CANVAS_TS_PLUGIN_NAME);
    expect(resolved?.location.replace(/\\/g, "/")).toMatch(
      /\/lsp-plugins\/node_modules\/pier-canvas-modules$/
    );
    expect(resourcesRootForLspPlugins()).toBe(join(process.cwd(), "resources"));
  });

  it("always remaps pier/canvas and pier/host onto the bundled SDK", () => {
    const canvas = plugin.overridePath("pier/canvas", true);
    const host = plugin.overridePath("pier/host", false);
    expect(canvas?.replace(/\\/g, "/")).toMatch(
      /system-skills\/pier-canvas\/sdk\/index\.d\.ts$/
    );
    expect(host?.replace(/\\/g, "/")).toMatch(
      /system-skills\/pier-canvas\/sdk\/host\.d\.ts$/
    );
    expect(plugin.sdkDir.replace(/\\/g, "/")).toMatch(
      /system-skills\/pier-canvas\/sdk$/
    );
  });

  it("fills in React types only when the workspace lookup failed", () => {
    expect(plugin.overridePath("react", true)).toBeNull();
    const react = plugin.overridePath("react", false);
    expect(react?.replace(/\\/g, "/")).toMatch(/@types\/react\/index\.d\.ts$/);
    const jsx = plugin.overridePath("react/jsx-runtime", false);
    expect(jsx?.replace(/\\/g, "/")).toMatch(
      /@types\/react\/jsx-runtime\.d\.ts$/
    );
  });

  it("injects the plugin into the bundled TypeScript language server", async () => {
    const launch = await createTypescriptLspProvider().resolveLaunch({
      rootPath: "/repo",
      workspaceKey: "main:/repo",
    });
    const plugins = (
      launch?.initializationOptions as {
        plugins?: Array<{ location?: string; name?: string }>;
      }
    )?.plugins;
    expect(plugins?.[0]?.name).toBe(PIER_CANVAS_TS_PLUGIN_NAME);
    expect(plugins?.[0]?.location).toBe(resolvePierCanvasTsPlugin()?.location);
  });

  it("packs lsp-plugins via electron-builder extraResources", () => {
    const builderConfig = readFileSync(
      join(process.cwd(), "electron-builder.yml"),
      "utf8"
    );
    expect(builderConfig).toMatch(/from:\s*resources\/lsp-plugins/);
    expect(builderConfig).toMatch(/to:\s*lsp-plugins/);
  });

  it("keeps a discoverable tsconfig next to canvas sources", () => {
    const canvasTsconfig = readFileSync(
      join(process.cwd(), ".pier/canvases/tsconfig.json"),
      "utf8"
    );
    expect(canvasTsconfig).toContain(
      '"extends": "../../tsconfig.canvases.json"'
    );
    expect(canvasTsconfig).toContain("../../src/renderer/global.d.ts");
  });

  it("roots canvas files at the canvases tsconfig when present", () => {
    const root = createTypescriptLspProvider().resolveRoot({
      fallbackWorkspaceRoot: process.cwd(),
      filePath: join(
        process.cwd(),
        ".pier/canvases/canvas-kit/canvas-kit.canvas.tsx"
      ),
    });
    expect(root.replace(/\\/g, "/")).toMatch(/\/\.pier\/canvases$/);
  });
});
