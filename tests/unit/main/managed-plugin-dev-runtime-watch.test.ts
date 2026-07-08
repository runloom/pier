import { isManagedPluginDevRuntimeFile } from "@main/app-core/managed-plugin-dev-runtime-watch.ts";
import { describe, expect, it } from "vitest";

describe("managed plugin dev runtime watch", () => {
  it("only treats runtime entry files and plugin manifest as hot-reload triggers", () => {
    expect(isManagedPluginDevRuntimeFile("plugin.json")).toBe(true);
    expect(isManagedPluginDevRuntimeFile("dist/main.js")).toBe(true);
    expect(isManagedPluginDevRuntimeFile("dist/renderer.js")).toBe(true);

    expect(
      isManagedPluginDevRuntimeFile("src/renderer/accounts-widget.tsx")
    ).toBe(false);
    expect(isManagedPluginDevRuntimeFile("dist-pkg/pier.codex-1.0.0.tgz")).toBe(
      false
    );
    expect(isManagedPluginDevRuntimeFile(null)).toBe(false);
  });
});
