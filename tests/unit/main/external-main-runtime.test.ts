import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createExternalMainPluginRuntime,
  type ExternalMainPluginContext,
} from "@main/plugins/external-main-runtime.ts";
import type { ManagedPluginRuntimeSource } from "@main/services/managed-plugins/install-runtime.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-external-runtime-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

function source(
  version: string,
  mainEntryPath: string,
  overrides: Partial<ManagedPluginRuntimeSource> = {}
): ManagedPluginRuntimeSource {
  return {
    assetsRoot: dir,
    enabled: true,
    id: "pier.codex",
    kind: "officialInstalled",
    mainEntryPath,
    manifest: {
      apiVersion: 1,
      commands: [],
      dashboardWidgets: [],
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

function contextFor(
  sourceArg: ManagedPluginRuntimeSource,
  errors: string[] = []
): ExternalMainPluginContext {
  return {
    events: { emit: vi.fn() },
    lifecycle: { onBeforeQuit: vi.fn() },
    logger: {
      debug: vi.fn(),
      error: (message) => errors.push(message),
      info: vi.fn(),
      warn: vi.fn(),
    },
    paths: { dataDir: dir, workDir: join(dir, sourceArg.id) },
    plugin: { id: sourceArg.id, version: sourceArg.version },
    rpc: { handle: vi.fn() },
  };
}

function rpcBusMock() {
  return {
    clearPlugin: vi.fn(),
    emit: vi.fn(),
    handle: vi.fn(),
    invoke: vi.fn(async () => ({
      error: { code: "not_found", message: "not stubbed" },
      ok: false as const,
    })),
  };
}

describe("external main plugin runtime", () => {
  it("reload flushes the previous activation, disposes it, and clears plugin RPC before activating the new source", async () => {
    const events: string[] = [];
    const v1 = join(dir, "main-1.0.0.js");
    const v2 = join(dir, "main-1.0.1.js");
    const moduleFor = (version: string): unknown => ({
      plugin: {
        activate(context: ExternalMainPluginContext) {
          events.push(`activate:${version}`);
          context.rpc.handle("version", async () => version);
          context.lifecycle.onBeforeQuit(() => {
            events.push(`flush:${version}`);
          });
          return () => events.push(`dispose:${version}`);
        },
        id: "pier.codex",
      },
    });
    const modules = new Map<string, unknown>([
      [pathToFileURL(v1).href, moduleFor("1.0.0")],
      [pathToFileURL(v2).href, moduleFor("1.0.1")],
    ]);
    const rpcBus = rpcBusMock();
    const errors: string[] = [];
    const recordActivationResult = vi.fn().mockResolvedValue(undefined);
    const runtime = createExternalMainPluginRuntime({
      createContext: (sourceArg) => contextFor(sourceArg, errors),
      importModule: async (moduleUrl) => modules.get(moduleUrl),
      recordActivationResult,
      rpcBus,
    });

    await runtime.activate(source("1.0.0", v1));
    await runtime.reload(source("1.0.1", v2));

    expect(errors).toEqual([]);
    expect(events).toEqual([
      "activate:1.0.0",
      "flush:1.0.0",
      "dispose:1.0.0",
      "activate:1.0.1",
    ]);
    expect(rpcBus.clearPlugin).toHaveBeenCalledWith("pier.codex");
    expect(recordActivationResult).toHaveBeenLastCalledWith({
      ok: true,
      phase: "main",
      pluginId: "pier.codex",
      version: "1.0.1",
    });
  });

  it("dispose flushes plugin callbacks before running the disposer", async () => {
    const events: string[] = [];
    const mainEntryPath = join(dir, "main.js");
    const runtime = createExternalMainPluginRuntime({
      createContext: contextFor,
      importModule: async () => ({
        plugin: {
          activate(context: ExternalMainPluginContext) {
            context.lifecycle.onBeforeQuit(() => {
              events.push("flush");
            });
            return () => events.push("dispose");
          },
          id: "pier.codex",
        },
      }),
      recordActivationResult: vi.fn().mockResolvedValue(undefined),
      rpcBus: rpcBusMock(),
    });

    await runtime.activate(source("1.0.0", mainEntryPath));
    await runtime.dispose("pier.codex");
    await runtime.flushAllBeforeQuit();

    expect(events).toEqual(["flush", "dispose"]);
  });

  it("adds sourceRevision to the dynamic import URL", async () => {
    const events: string[] = [];
    const mainEntryPath = join(dir, "main.js");
    const sourceUrl = new URL(pathToFileURL(mainEntryPath).href);
    sourceUrl.searchParams.set("rev", "rev-1");
    const importModule = vi.fn(async () => ({
      plugin: {
        activate() {
          events.push("activate");
          return () => undefined;
        },
        id: "pier.codex",
      },
    }));
    const runtime = createExternalMainPluginRuntime({
      createContext: contextFor,
      importModule,
      recordActivationResult: vi.fn().mockResolvedValue(undefined),
      rpcBus: rpcBusMock(),
    });

    await runtime.activate(
      source("1.0.0", mainEntryPath, { sourceRevision: "rev-1" })
    );

    expect(importModule).toHaveBeenCalledWith(sourceUrl.href);
    expect(events).toEqual(["activate"]);
  });
});
