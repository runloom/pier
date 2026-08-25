import {
  createManagedPluginRuntimeReconciler,
  runtimeSourceActivationKey,
} from "@main/app-core/managed-plugin-runtime-reconciler.ts";
import type { ExternalMainPluginRuntime } from "@main/plugins/external-main-runtime.ts";
import type { ManagedPluginRuntimeSource } from "@main/services/managed-plugins/install-runtime.ts";
import { describe, expect, it, vi } from "vitest";

function source(
  version: string,
  overrides: Partial<ManagedPluginRuntimeSource> = {}
): ManagedPluginRuntimeSource {
  return {
    assetsRoot: `/tmp/pier.codex/${version}`,
    enabled: true,
    id: "pier.codex",
    kind: "officialInstalled",
    mainEntryPath: `/tmp/pier.codex/${version}/dist/main.js`,
    manifest: {
      apiVersion: 1,
      commands: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.codex",
      main: "dist/main.js",
      name: "Codex",
      panels: [],
      permissions: [],
      renderer: "dist/renderer.js",
      settingsPages: [],
      terminalStatusItems: [],
      version,
      workbenchWidgets: [],
      dataProjections: [],
    },
    rendererEntryUrl: `pier-plugin://pier.codex/${version}/dist/renderer.js`,
    version,
    ...overrides,
  };
}

function runtime(): ExternalMainPluginRuntime {
  return {
    activate: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    disposeAll: vi.fn().mockResolvedValue(undefined),
    flushAllBeforeQuit: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
  };
}

describe("managed plugin runtime reconciler", () => {
  it("activates new enabled sources and disposes sources that become disabled or disappear", async () => {
    const externalRuntime = runtime();
    const reconciler = createManagedPluginRuntimeReconciler(externalRuntime);

    await reconciler.reconcile([source("1.0.0")]);
    await reconciler.reconcile([source("1.0.0", { enabled: false })]);
    await reconciler.reconcile([]);

    expect(externalRuntime.activate).toHaveBeenCalledTimes(1);
    expect(externalRuntime.dispose).toHaveBeenCalledTimes(1);
    expect(externalRuntime.dispose).toHaveBeenCalledWith("pier.codex");
  });

  it("reloads an enabled source when its activation key changes", async () => {
    const externalRuntime = runtime();
    const reconciler = createManagedPluginRuntimeReconciler(externalRuntime);

    await reconciler.reconcile([source("1.0.0")]);
    await reconciler.reconcile([source("1.0.1")]);

    expect(externalRuntime.activate).toHaveBeenCalledTimes(1);
    expect(externalRuntime.reload).toHaveBeenCalledTimes(1);
    expect(externalRuntime.reload).toHaveBeenCalledWith(source("1.0.1"));
  });

  it("uses sourceRevision as part of the activation key", () => {
    const stable = source("1.0.0");
    const revised = source("1.0.0", { sourceRevision: "rev-2" });

    expect(runtimeSourceActivationKey(stable)).not.toBe(
      runtimeSourceActivationKey(revised)
    );
  });

  it("awaits ensurePath before first activate and reload", async () => {
    const order: string[] = [];
    const externalRuntime = runtime();
    externalRuntime.activate = vi.fn(async () => {
      order.push("activate");
    });
    externalRuntime.reload = vi.fn(async () => {
      order.push("reload");
    });
    const ensurePath = vi.fn(async () => {
      order.push("ensurePath");
    });
    const reconciler = createManagedPluginRuntimeReconciler(externalRuntime, {
      ensurePath,
    });

    await reconciler.reconcile([source("1.0.0")]);
    await reconciler.reconcile([source("1.0.1")]);

    expect(ensurePath).toHaveBeenCalledTimes(2);
    expect(order).toEqual(["ensurePath", "activate", "ensurePath", "reload"]);
  });

  // 失败语义契约 F2（docs/superpowers/specs/2026-08-24-plugin-failure-semantics.md）：
  // 单个插件 activate 失败不阻断后续插件的激活。
  it("continues activating later plugins when an earlier activate throws (F2)", async () => {
    const externalRuntime = runtime();
    const first = source("1.0.0", { id: "pier.first" });
    const second = source("1.0.0", { id: "pier.second" });
    externalRuntime.activate = vi.fn(async (activated) => {
      if (activated.id === "pier.first") {
        throw new Error("boom");
      }
    });
    const reconciler = createManagedPluginRuntimeReconciler(externalRuntime);

    await expect(
      reconciler.reconcile([first, second])
    ).resolves.toBeUndefined();

    expect(externalRuntime.activate).toHaveBeenCalledTimes(2);
  });

  it("clears the active key when reload throws so the next pass retries (F2)", async () => {
    const externalRuntime = runtime();
    const plugin = source("1.0.0");
    const reconciler = createManagedPluginRuntimeReconciler(externalRuntime);
    await reconciler.reconcile([plugin]);

    externalRuntime.reload = vi.fn(async () => {
      throw new Error("reload boom");
    });
    await expect(
      reconciler.reconcile([source("1.0.1")])
    ).resolves.toBeUndefined();
    expect(externalRuntime.dispose).not.toHaveBeenCalled();

    // 下一次 reconcile 视为未激活，重新走 activate。
    externalRuntime.reload = vi.fn().mockResolvedValue(undefined);
    await reconciler.reconcile([source("1.0.1")]);
    expect(externalRuntime.activate).toHaveBeenCalledTimes(2);
  });
});
