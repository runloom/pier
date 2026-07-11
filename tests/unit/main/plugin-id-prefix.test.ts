import {
  findMissionControlWidgetIdConflict,
  findPluginIdDotPrefixConflict,
} from "@main/services/plugin-contribution-conflicts.ts";
import type { PluginStateStore } from "@main/services/plugin-service.ts";
import { createPluginService } from "@main/services/plugin-service.ts";
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

function externalSource(id: string) {
  const manifest = pluginManifestSchema.parse({
    apiVersion: 1,
    engines: { pier: ">=0.1.0" },
    id,
    name: id,
    source: { kind: "official" },
    version: "1.0.0",
  });
  return {
    enabled: true,
    id,
    manifest,
    rendererEntryUrl: `pier-plugin://${id}/renderer.js`,
    source: "official" as const,
    version: manifest.version,
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

function builtinSourceWithCommands(id: string, commandIds: readonly string[]) {
  return {
    kind: "builtin" as const,
    manifest: {
      apiVersion: 1,
      commands: commandIds.map((commandId) => ({
        id: commandId,
        permissions: [],
        title: commandId,
      })),
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      source: { kind: "builtin" },
      version: "1.0.0",
    },
  };
}

function builtinSourceWithPanels(id: string, panelIds: readonly string[]) {
  return {
    kind: "builtin" as const,
    manifest: {
      apiVersion: 1,
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      panels: panelIds.map((panelId) => ({
        id: panelId,
        permissions: [],
        title: panelId,
      })),
      source: { kind: "builtin" },
      version: "1.0.0",
    },
  };
}

function builtinSourceWithWidget(id: string, widgetId: string) {
  return {
    kind: "builtin" as const,
    manifest: {
      apiVersion: 1,
      engines: { pier: ">=0.1.0" },
      id,
      missionControlWidgets: [
        { id: widgetId, permissions: [], title: widgetId },
      ],
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

  it("内置与外部插件进入同一全局 id 冲突校验", async () => {
    const service = createPluginService({
      externalRuntimeSources: () => [externalSource("pier.git.extras")],
      sources: [builtinSource("pier.git")],
      state: memoryState(),
    });

    const result = await service.list();

    expect(result.entries.map((entry) => entry.manifest.id)).toEqual([
      "pier.git",
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "invalid_manifest",
        message: expect.stringContaining("pier.git.extras"),
        source: { kind: "official" },
      }),
    ]);
  });

  it("外部插件之间的重复和点分段前缀冲突也拒绝后者", async () => {
    const service = createPluginService({
      externalRuntimeSources: () => [
        externalSource("pier.external"),
        externalSource("pier.external.child"),
        externalSource("pier.external"),
      ],
      state: memoryState(),
    });

    const result = await service.list();

    expect(result.entries.map((entry) => entry.manifest.id)).toEqual([
      "pier.external",
    ]);
    expect(result.diagnostics).toHaveLength(2);
    expect(
      result.diagnostics.every((item) => item.code === "invalid_manifest")
    ).toBe(true);
  });

  it("外部插件也参与跨插件状态项唯一性校验", async () => {
    const external = externalSource("pier.beta");
    external.manifest.terminalStatusItems = [
      { id: "shared.status", permissions: [], title: "External status" },
    ];
    const service = createPluginService({
      externalRuntimeSources: () => [external],
      sources: [builtinSourceWithStatusItem("pier.alpha", "shared.status")],
      state: memoryState(),
    });

    const result = await service.list();

    expect(result.entries.map((entry) => entry.manifest.id)).toEqual([
      "pier.alpha",
    ]);
    expect(result.diagnostics[0]?.message).toContain("shared.status");
  });

  it("外部插件也参与跨插件指挥中心物料唯一性校验", async () => {
    const external = externalSource("pier.beta");
    external.manifest.missionControlWidgets = [
      { id: "shared.widget", permissions: [], title: "External widget" },
    ];
    const service = createPluginService({
      externalRuntimeSources: () => [external],
      sources: [builtinSourceWithWidget("pier.alpha", "shared.widget")],
      state: memoryState(),
    });

    const result = await service.list();

    expect(result.entries.map((entry) => entry.manifest.id)).toEqual([
      "pier.alpha",
    ]);
    expect(result.diagnostics[0]?.message).toContain("shared.widget");
  });

  it("同一插件清单内的重复 command id 会被拒绝", async () => {
    const service = createPluginService({
      sources: [
        builtinSourceWithCommands("pier.duplicate", [
          "shared.command",
          "shared.command",
        ]),
      ],
      state: memoryState(),
    });

    const result = await service.list();

    expect(result.entries).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("shared.command");
  });

  it("插件清单不能占用宿主核心 action id", async () => {
    const service = createPluginService({
      sources: [
        builtinSourceWithCommands("pier.duplicate", ["pier.panel.newTab"]),
      ],
      state: memoryState(),
    });

    const result = await service.list();

    expect(result.entries).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("pier.panel.newTab");
  });

  it("同一插件清单内的重复 panel id 会被拒绝", async () => {
    const service = createPluginService({
      sources: [
        builtinSourceWithPanels("pier.duplicate", [
          "shared.panel",
          "shared.panel",
        ]),
      ],
      state: memoryState(),
    });

    const result = await service.list();

    expect(result.entries).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("shared.panel");
  });

  it("插件清单不能占用宿主保留 panel id", async () => {
    const service = createPluginService({
      sources: [builtinSourceWithPanels("pier.duplicate", ["terminal"])],
      state: memoryState(),
    });

    const result = await service.list();

    expect(result.entries).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("terminal");
  });

  it("插件清单不能占用宿主核心状态项 id", async () => {
    const service = createPluginService({
      sources: [
        builtinSourceWithStatusItem("pier.duplicate", "core.agent-status"),
      ],
      state: memoryState(),
    });

    const result = await service.list();

    expect(result.entries).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("core.agent-status");
  });

  it("插件清单不能占用宿主核心指挥中心物料 id", async () => {
    const service = createPluginService({
      sources: [builtinSourceWithWidget("pier.duplicate", "core.custom-card")],
      state: memoryState(),
    });

    const result = await service.list();

    expect(result.entries).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("core.custom-card");
  });

  it("内置与外部插件的 command id 冲突时拒绝外部插件", async () => {
    const external = externalSource("pier.beta");
    external.manifest.commands = [
      { id: "shared.command", permissions: [], title: "External command" },
    ];
    const service = createPluginService({
      externalRuntimeSources: () => [external],
      sources: [builtinSourceWithCommands("pier.alpha", ["shared.command"])],
      state: memoryState(),
    });

    const result = await service.list();

    expect(result.entries.map((entry) => entry.manifest.id)).toEqual([
      "pier.alpha",
    ]);
    expect(result.diagnostics[0]?.message).toContain("shared.command");
  });

  it("外部插件之间的 panel id 冲突时拒绝后者", async () => {
    const first = externalSource("pier.alpha");
    first.manifest.panels = [
      { id: "shared.panel", permissions: [], title: "First panel" },
    ];
    const second = externalSource("pier.beta");
    second.manifest.panels = [
      { id: "shared.panel", permissions: [], title: "Second panel" },
    ];
    const service = createPluginService({
      externalRuntimeSources: () => [first, second],
      state: memoryState(),
    });

    const result = await service.list();

    expect(result.entries.map((entry) => entry.manifest.id)).toEqual([
      "pier.alpha",
    ]);
    expect(result.diagnostics[0]?.message).toContain("shared.panel");
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
