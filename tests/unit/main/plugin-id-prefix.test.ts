import type { PluginStateStore } from "@main/services/plugin-service.ts";
import {
  createPluginService,
  findMissionControlWidgetIdConflict,
  findPluginIdDotPrefixConflict,
} from "@main/services/plugin-service.ts";
import type { PluginRegistryState } from "@shared/contracts/plugin.ts";
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
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

function builtinSourceWithStatusItem(id: string, statusItemId: string) {
  return {
    kind: "builtin" as const,
    manifest: {
      apiVersion: 1,
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      source: { kind: "builtin" },
      terminalStatusItems: [
        {
          id: statusItemId,
          permissions: [],
          title: statusItemId,
        },
      ],
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

describe("plugin registry — terminalStatusItems id 跨插件唯一性", () => {
  it("两插件声明同一 status item id，后者被拒并带 invalid_manifest 诊断", async () => {
    const service = createPluginService({
      sources: [
        builtinSourceWithStatusItem("pier.alpha", "shared.status"),
        builtinSourceWithStatusItem("pier.beta", "shared.status"),
      ],
      state: memoryState(),
    });
    const result = await service.list();
    expect(result.entries.map((entry) => entry.manifest.id)).toEqual([
      "pier.alpha",
    ]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("invalid_manifest");
    expect(result.diagnostics[0]?.message).toContain("shared.status");
    expect(result.diagnostics[0]?.message).toContain("pier.beta");
  });

  it("不同插件声明不同 status item id 可以共存", async () => {
    const service = createPluginService({
      sources: [
        builtinSourceWithStatusItem("pier.alpha", "alpha.status"),
        builtinSourceWithStatusItem("pier.beta", "beta.status"),
      ],
      state: memoryState(),
    });
    const result = await service.list();
    expect(result.entries.map((entry) => entry.manifest.id)).toEqual([
      "pier.alpha",
      "pier.beta",
    ]);
    expect(result.diagnostics).toHaveLength(0);
  });
});

function manifestWith(overrides: {
  missionControlWidgets?: Array<{
    id: string;
    permissions: string[];
    title: string;
  }>;
  id: string;
}) {
  return pluginManifestSchema.parse({
    apiVersion: 1,
    missionControlWidgets: overrides.missionControlWidgets ?? [],
    engines: { pier: ">=0.1.0" },
    id: overrides.id,
    name: overrides.id,
    source: { kind: "builtin" },
    version: "1.0.0",
  });
}

describe("findMissionControlWidgetIdConflict", () => {
  it("两个插件声明同一 widget id 时返回冲突 id", () => {
    const accepted = manifestWith({
      missionControlWidgets: [
        { id: "pier.a.widget", permissions: [], title: "A Widget" },
      ],
      id: "pier.a",
    });
    const candidate = manifestWith({
      missionControlWidgets: [
        { id: "pier.a.widget", permissions: [], title: "Steal" },
      ],
      id: "pier.b",
    });
    expect(findMissionControlWidgetIdConflict([accepted], candidate)).toBe(
      "pier.a.widget"
    );
  });

  it("无重叠 id 时返回 null", () => {
    const accepted = manifestWith({
      missionControlWidgets: [
        { id: "pier.a.widget", permissions: [], title: "A Widget" },
      ],
      id: "pier.a",
    });
    const candidate = manifestWith({
      missionControlWidgets: [
        { id: "pier.b.widget", permissions: [], title: "B Widget" },
      ],
      id: "pier.b",
    });
    expect(
      findMissionControlWidgetIdConflict([accepted], candidate)
    ).toBeNull();
  });
});
