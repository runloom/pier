import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { House } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRendererPluginContext } from "@/lib/plugins/host-context.ts";
import {
  clearPluginPanelsForTests,
  getPluginPanelRegistrations,
} from "@/lib/plugins/plugin-panel-registry.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function entryWithPanel(): PluginRegistryEntry {
  return {
    effectivePermissions: ["panel:register", "panel:open"],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.test",
      name: "Test",
      panels: [{ id: "pier.test.panel", permissions: [], title: "Test" }],
      permissions: ["panel:register", "panel:open"],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

const undeclaredContributionErrorPattern = /not declared/;

const panelReg = {
  component: () => null,
  icon: House,
  id: "pier.test.panel",
  kind: "web",
} as const;

describe("host-context panels", () => {
  afterEach(() => {
    clearPluginPanelsForTests();
    vi.restoreAllMocks();
  });

  it("register writes to the plugin panel registry", () => {
    const ctx = createRendererPluginContext(entryWithPanel());
    ctx.panels.register(panelReg);
    expect(getPluginPanelRegistrations().get("pier.test.panel")).toBe(panelReg);
  });

  it("register throws when panel id is not declared in manifest", () => {
    const ctx = createRendererPluginContext(entryWithPanel());
    expect(() =>
      ctx.panels.register({ ...panelReg, id: "pier.test.undeclared" })
    ).toThrow(undeclaredContributionErrorPattern);
  });

  it("open is a no-op when workspace api is absent", () => {
    useWorkspaceStore.setState({ api: null });
    const ctx = createRendererPluginContext(entryWithPanel());
    expect(() => ctx.panels.open("pier.test.panel")).not.toThrow();
  });
});
