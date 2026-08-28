// @vitest-environment jsdom
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const maybeActivateViaSandboxTrack = vi.hoisted(() => vi.fn());

vi.mock("@/lib/plugins/sandbox/dispatch.tsx", () => ({
  maybeActivateViaSandboxTrack,
}));

import { RendererPluginRuntime } from "@/lib/plugins/runtime/index.ts";

function thirdPartyEntry(id: string): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      panels: [],
      permissions: [],
      settingsPages: [],
      source: { kind: "local" },
      terminalStatusItems: [],
      version: "1.0.0",
      canvasActions: [],
      dataProjections: [],
    },
    runtime: {
      canToggle: true,
      enabled: true,
      kind: "external",
      rendererEntryUrl: `pier-plugin://${id}/1/renderer.js`,
    },
  };
}

describe("sandbox activation pendingExternal cleanup", () => {
  afterEach(() => {
    maybeActivateViaSandboxTrack.mockReset();
    vi.restoreAllMocks();
  });

  it("clears pendingExternal after a successful sandbox takeover", async () => {
    maybeActivateViaSandboxTrack.mockImplementation(
      (
        runtime: { active: Map<string, unknown> },
        entry: PluginRegistryEntry
      ) => {
        runtime.active.set(entry.manifest.id, {
          dispose: () => undefined,
          kind: "external",
          signature: "sig",
          state: "active",
        });
        return true;
      }
    );
    const loadExternalModule = vi.fn();
    const runtime = new RendererPluginRuntime([], { loadExternalModule });
    await runtime.refresh([thirdPartyEntry("third.demo")]);
    runtime.startExternalActivations();
    await vi.waitFor(() => {
      expect(runtime.diagnostics().pendingExternalPluginIds).toEqual([]);
    });
    expect(loadExternalModule).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("clears pendingExternal and reports failure when sandbox resolve throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    maybeActivateViaSandboxTrack.mockImplementation(() => {
      throw new Error(
        "sandbox track could not resolve declared panels: third.demo.panel"
      );
    });
    const loadExternalModule = vi.fn();
    const reportExternalActivation = vi.fn(async () => undefined);
    const runtime = new RendererPluginRuntime([], {
      loadExternalModule,
      reportExternalActivation,
    });
    await runtime.refresh([thirdPartyEntry("third.demo")]);
    runtime.startExternalActivations();
    await vi.waitFor(() => {
      expect(runtime.diagnostics().pendingExternalPluginIds).toEqual([]);
    });
    expect(loadExternalModule).not.toHaveBeenCalled();
    expect(reportExternalActivation).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        pluginId: "third.demo",
      })
    );
    await runtime.dispose();
  });
});
