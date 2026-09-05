import type { GitFileBaselineResult as ExternalResult } from "@pier/plugin-api/renderer";
import type { GitFileBaselineResult } from "@shared/contracts/git/file-baseline.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createExternalRendererPluginContext } from "@/lib/plugins/external/context.ts";
import { createRendererPluginContext } from "@/lib/plugins/host/context.ts";

function entry(permissions: PierCapability[]): PluginRegistryEntry {
  return {
    effectivePermissions: permissions,
    enabled: true,
    manifest: {
      apiVersion: 1,
      id: "pier.baseline-test",
      name: "Baseline",
      version: "1.0.0",
      engines: { pier: ">=0.1.0" },
      source: { kind: "official" },
      permissions: ["git:read"],
      commands: [],
      panels: [],
      settingsPages: [],
      terminalStatusItems: [],
      canvasActions: [],
      dataProjections: [],
    },
    runtime: { canToggle: true, enabled: true, kind: "external" },
  };
}

const bridge = {
  invoke: vi.fn(async () => ({ ok: true, data: null })),
  subscribe: vi.fn(() => () => undefined),
};

afterEach(() => vi.unstubAllGlobals());

describe("plugin file baseline API", () => {
  for (const kind of ["builtin", "external"] as const) {
    const context = (permissions: PierCapability[]) =>
      kind === "builtin"
        ? createRendererPluginContext(entry(permissions))
        : createExternalRendererPluginContext(
            entry(permissions),
            bridge,
            () => []
          );

    it(`${kind} enforces effective git:read permission before access`, async () => {
      const getFileBaseline = vi.fn();
      vi.stubGlobal("window", { pier: { git: { getFileBaseline } } });
      await expect(
        Promise.resolve().then(() =>
          context([]).git.getFileBaseline({ root: "/repo", path: "a.txt" })
        )
      ).rejects.toThrow(/git:read/u);
      expect(getFileBaseline).not.toHaveBeenCalled();
    });

    it(`${kind} returns the exact service result and request`, async () => {
      const result: GitFileBaselineResult = {
        status: "unavailable",
        reason: "binary",
      };
      const getFileBaseline = vi.fn(async () => result);
      vi.stubGlobal("window", { pier: { git: { getFileBaseline } } });
      expect(
        await context(["git:read"]).git.getFileBaseline({
          root: "/repo",
          path: "a.txt",
        })
      ).toEqual(result);
      expect(getFileBaseline).toHaveBeenCalledWith({
        root: "/repo",
        path: "a.txt",
      });
    });
  }

  it("keeps the external result mirror identical to the host contract", () => {
    expectTypeOf<ExternalResult>().toEqualTypeOf<GitFileBaselineResult>();
  });
});
