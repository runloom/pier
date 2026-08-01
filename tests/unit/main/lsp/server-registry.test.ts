import { describe, expect, it } from "vitest";
import { createBootstrappedLspRegistry } from "../../../../src/main/services/lsp/bootstrap-providers.ts";
import { createTypescriptLspProvider } from "../../../../src/main/services/lsp/providers/typescript-provider.ts";
import { LspServerRegistry } from "../../../../src/main/services/lsp/server-registry.ts";
import type { LspServerProvider } from "../../../../src/shared/contracts/lsp-provider.ts";

function stubProvider(input: {
  id: string;
  match?: (path: string) => boolean;
  priority: number;
}): LspServerProvider {
  return {
    displayName: input.id,
    id: input.id,
    languageIdForPath: () => "x",
    matchPath: input.match ?? (() => false),
    priority: input.priority,
    resolveLaunch: () => ({
      args: [],
      command: "x",
      cwd: "/",
    }),
    resolveRoot: (args) => args.fallbackWorkspaceRoot,
    rootMarkers: [],
    selector: { extensions: [], languageIds: ["x"] },
  };
}

describe("LspServerRegistry", () => {
  it("matches typescript provider for js/ts extensions", () => {
    const registry = createBootstrappedLspRegistry();
    expect(registry.matchForPath("/a/b.ts")?.id).toBe("typescript");
    expect(registry.matchForPath("/a/b.tsx")?.id).toBe("typescript");
    expect(registry.matchForPath("/a/b.mjs")?.id).toBe("typescript");
    expect(registry.matchForPath("/a/b.md")).toBeNull();
  });

  it("picks higher priority when multiple match", () => {
    const registry = new LspServerRegistry();
    registry.register(
      stubProvider({
        id: "low",
        match: () => true,
        priority: 10,
      })
    );
    registry.register(
      stubProvider({
        id: "high",
        match: () => true,
        priority: 50,
      })
    );
    expect(registry.matchForPath("/any")?.id).toBe("high");
  });

  it("typescript launch resolves bundled cli", async () => {
    const provider = createTypescriptLspProvider();
    const launch = await provider.resolveLaunch({
      rootPath: "/repo",
      workspaceKey: "main:/repo",
    });
    expect(launch).not.toBeNull();
    if (!launch) {
      return;
    }
    expect(launch.command.length).toBeGreaterThan(0);
    expect(launch.args.some((arg) => String(arg).includes("cli.mjs"))).toBe(
      true
    );
    expect(launch.cwd).toBe("/repo");
  });

  it("languageIdForPath covers react and module variants", () => {
    const provider = createTypescriptLspProvider();
    expect(provider.languageIdForPath("a.tsx")).toBe("typescriptreact");
    expect(provider.languageIdForPath("a.cts")).toBe("typescript");
    expect(provider.languageIdForPath("a.jsx")).toBe("javascriptreact");
  });
});
