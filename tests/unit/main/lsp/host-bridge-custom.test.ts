import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachPluginLanguageServers,
  bindLspHostBridge,
  syncCustomLanguageServers,
  unbindLspHostBridge,
} from "../../../../src/main/services/lsp/host-bridge.ts";
import { LspServerRegistry } from "../../../../src/main/services/lsp/server-registry.ts";
import type { LspSessionHost } from "../../../../src/main/services/lsp/session-host.ts";

afterEach(() => {
  unbindLspHostBridge();
});

describe("syncCustomLanguageServers", () => {
  it("registers and replaces custom providers", () => {
    const registry = new LspServerRegistry();
    const host = {
      closeMany: async () => true,
      listSessionIdsForServer: () => [],
    } as unknown as LspSessionHost;
    bindLspHostBridge({ host, registry });

    syncCustomLanguageServers([
      {
        args: ["--stdio"],
        command: "solargraph",
        displayName: "Ruby",
        extensions: [".rb"],
        highlightPreset: "text",
        id: "ruby",
        languageIds: ["ruby"],
        priority: 50,
        rootMarkers: ["Gemfile"],
      },
    ]);
    expect(registry.getById("custom:ruby")).not.toBeNull();
    expect(registry.matchForPath("/app/foo.rb")?.id).toBe("custom:ruby");

    syncCustomLanguageServers([]);
    expect(registry.getById("custom:ruby")).toBeNull();
  });
});

describe("attachPluginLanguageServers dispose", () => {
  it("unregisters only after closeMany settles when sessions exist", async () => {
    const registry = new LspServerRegistry();
    let resolveClose: (() => void) | undefined;
    const closeGate = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const closeMany = vi.fn(async () => {
      await closeGate;
      return true;
    });
    const host = {
      closeMany,
      listSessionIdsForServer: (id: string) =>
        id === "pier.lsp-zig:zls" ? ["sess-1"] : [],
    } as unknown as LspSessionHost;
    bindLspHostBridge({ host, registry });

    const dispose = attachPluginLanguageServers({
      contributions: [
        {
          args: [],
          command: "zls",
          displayName: "Zig",
          extensions: [".zig"],
          id: "zls",
          languageIds: ["zig"],
          priority: 70,
          rootMarkers: ["build.zig"],
        },
      ],
      pluginId: "pier.lsp-zig",
    });
    expect(registry.getById("pier.lsp-zig:zls")).not.toBeNull();

    dispose();
    // Still registered until closeMany completes.
    expect(registry.getById("pier.lsp-zig:zls")).not.toBeNull();
    expect(closeMany).toHaveBeenCalledWith(["sess-1"], "policy-disabled");

    resolveClose?.();
    await vi.waitFor(() => {
      expect(registry.getById("pier.lsp-zig:zls")).toBeNull();
    });
  });
});
