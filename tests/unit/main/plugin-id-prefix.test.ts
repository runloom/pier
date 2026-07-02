import type { PluginStateStore } from "@main/services/plugin-service.ts";
import {
  createPluginService,
  findPluginIdDotPrefixConflict,
} from "@main/services/plugin-service.ts";
import type { PluginRegistryState } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";

function builtinSource(id: string) {
  return {
    kind: "builtin" as const,
    manifest: {
      apiVersion: 1,
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      source: { kind: "builtin" },
      version: "1.0.0",
    },
  };
}

function memoryState(): PluginStateStore {
  let state: PluginRegistryState = { plugins: {}, version: 1 };
  return {
    read: () => Promise.resolve(state),
    setEnabled: (id, enabled) => {
      state = {
        ...state,
        plugins: { ...state.plugins, [id]: { enabled, updatedAt: 0 } },
      };
      return Promise.resolve(state);
    },
  };
}

describe("findPluginIdDotPrefixConflict", () => {
  it("点分段前缀与重复 id 都算冲突", () => {
    expect(findPluginIdDotPrefixConflict(["pier.git"], "pier.git.extras")).toBe(
      "pier.git"
    );
    expect(findPluginIdDotPrefixConflict(["pier.git.extras"], "pier.git")).toBe(
      "pier.git.extras"
    );
    expect(findPluginIdDotPrefixConflict(["pier.git"], "pier.git")).toBe(
      "pier.git"
    );
  });

  it("非点分段前缀不算冲突（pier.git vs pier.gitx）", () => {
    expect(findPluginIdDotPrefixConflict(["pier.git"], "pier.gitx")).toBeNull();
  });
});

describe("plugin registry — 插件 id 互为点分前缀拒绝", () => {
  it("pier.git 与 pier.git.extras 不能共存，后者走 invalid_manifest 诊断", async () => {
    const service = createPluginService({
      sources: [builtinSource("pier.git"), builtinSource("pier.git.extras")],
      state: memoryState(),
    });
    const result = await service.list();
    expect(result.entries.map((entry) => entry.manifest.id)).toEqual([
      "pier.git",
    ]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("invalid_manifest");
    expect(result.diagnostics[0]?.message).toContain("pier.git.extras");
  });

  it("pier.git 与 pier.gitx 可以共存", async () => {
    const service = createPluginService({
      sources: [builtinSource("pier.git"), builtinSource("pier.gitx")],
      state: memoryState(),
    });
    const result = await service.list();
    expect(result.entries.map((entry) => entry.manifest.id)).toEqual([
      "pier.git",
      "pier.gitx",
    ]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
