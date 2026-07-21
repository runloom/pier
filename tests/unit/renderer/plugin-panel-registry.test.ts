import { GIT_CHANGES_PANEL_ID } from "@plugins/builtin/git/manifest.ts";
import { createGitPanelTransferRegistration } from "@plugins/builtin/git/renderer/git-panel-transfer.ts";
import { House } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearCorePanelTransferForTests,
  getCorePanelTransferRegistration,
  isPanelTransferMovable,
  panelTransferRegistrationOf,
  registerCorePanelTransfer,
} from "@/components/workspace/panel-transfer-adapters.ts";
import {
  clearPluginPanelsForTests,
  getPluginPanelRegistrations,
  registerPluginPanel,
} from "@/lib/plugins/plugin-panel-registry.ts";

const reg = {
  component: () => null,
  icon: House,
  id: "pier.test.panel",
  kind: "web",
} as const;

describe("plugin-panel-registry", () => {
  afterEach(() => {
    clearPluginPanelsForTests();
    clearCorePanelTransferForTests();
  });

  it("registers and exposes a panel", () => {
    registerPluginPanel(reg);
    expect(getPluginPanelRegistrations().get("pier.test.panel")).toBe(reg);
  });

  it("dispose removes only its own registration", () => {
    const dispose = registerPluginPanel(reg);
    dispose();
    expect(getPluginPanelRegistrations().has("pier.test.panel")).toBe(false);
  });

  it("rejects a duplicate registration instead of replacing its owner", () => {
    registerPluginPanel(reg);
    const replacement = { ...reg, icon: House };

    expect(() => registerPluginPanel(replacement)).toThrow(
      "plugin panel id is already registered"
    );
    expect(getPluginPanelRegistrations().get("pier.test.panel")).toBe(reg);
  });

  it("resolves transfer registrations core-first and rejects external kind:terminal", () => {
    expect(getCorePanelTransferRegistration("welcome")).toEqual({
      kind: "params",
    });
    expect(getCorePanelTransferRegistration("terminal")).toEqual({
      kind: "terminal",
    });
    expect(panelTransferRegistrationOf("welcome")?.kind).toBe("params");
    expect(panelTransferRegistrationOf("terminal")?.kind).toBe("terminal");
    expect(isPanelTransferMovable("welcome")).toBe(true);
    expect(isPanelTransferMovable("terminal")).toBe(true);

    registerPluginPanel({
      component: () => null,
      icon: House,
      id: "pier.external.managed",
      kind: "web",
    });
    expect(
      panelTransferRegistrationOf("pier.external.managed")
    ).toBeUndefined();
    expect(isPanelTransferMovable("pier.external.managed")).toBe(false);

    registerPluginPanel({
      component: () => null,
      icon: House,
      id: "pier.external.terminal-claim",
      kind: "web",
      transfer: { kind: "terminal" } as never,
    });
    expect(
      panelTransferRegistrationOf("pier.external.terminal-claim")
    ).toBeUndefined();
    expect(isPanelTransferMovable("pier.external.terminal-claim")).toBe(false);

    registerCorePanelTransfer("pier.test.core-first", { kind: "params" });
    registerPluginPanel({
      component: () => null,
      icon: House,
      id: "pier.test.core-first",
      kind: "web",
      transfer: {
        finalize: async () => undefined,
        kind: "custom",
        prepareSource: async () => ({ drafts: [] }),
        restore: async () => undefined,
        stageTarget: async () => undefined,
      },
    });
    expect(panelTransferRegistrationOf("pier.test.core-first")).toEqual({
      kind: "params",
    });
  });

  it("exposes Git changes as a custom core transfer registration", () => {
    const dispose = registerCorePanelTransfer(
      GIT_CHANGES_PANEL_ID,
      createGitPanelTransferRegistration()
    );
    expect(panelTransferRegistrationOf(GIT_CHANGES_PANEL_ID)?.kind).toBe(
      "custom"
    );
    expect(isPanelTransferMovable(GIT_CHANGES_PANEL_ID)).toBe(true);
    dispose();
  });
});
