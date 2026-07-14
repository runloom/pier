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
      workbenchWidgets: [],
      settingsPages: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.codex",
      main: "dist/main.js",
      name: "Codex",
      panels: [],
      permissions: [],
      renderer: "dist/renderer.js",
      terminalStatusItems: [],
      version,
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
});
