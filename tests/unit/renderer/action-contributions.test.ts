import { describe, expect, it, vi } from "vitest";
import {
  createActionFromContribution,
  evaluateActionWhen,
} from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { PANEL_LAYOUT_ACTION_CONTRIBUTIONS } from "@/lib/actions/panel-layout-contributions.ts";

function runtime(groupCount: number) {
  return {
    getContext: () => ({
      workspace: {
        activeGroupPanelCount: 1,
        groupCount,
        hasActivePanel: true,
        hasApi: true,
        panelCount: groupCount,
      },
    }),
    resolveAliases: (key: string) =>
      key === "commandPalette.aliases.equalizePanels"
        ? ["平分面板", "balance panels", "junfen", "jfmb"]
        : [],
    t: (key: string) => key,
  };
}

describe("action contributions", () => {
  it("declares panel layout actions as contributions", () => {
    expect(
      PANEL_LAYOUT_ACTION_CONTRIBUTIONS.map((action) => action.id)
    ).toEqual(
      expect.arrayContaining([
        "pier.panel.toggleMaximized",
        "pier.panel.equalizeSplits",
        "pier.panel.close",
        "pier.panel.closeOthers",
        "pier.panel.closeAll",
        "pier.panel.splitRight",
        "pier.panel.splitDown",
        "pier.panel.splitLeft",
        "pier.panel.splitUp",
        "pier.panel.focusRight",
        "pier.panel.focusDown",
        "pier.panel.focusLeft",
        "pier.panel.focusUp",
      ])
    );
  });

  it("builds runtime actions from contribution metadata and aliases", () => {
    const contribution = PANEL_LAYOUT_ACTION_CONTRIBUTIONS.find(
      (action) => action.id === "pier.panel.equalizeSplits"
    );

    expect(contribution?.aliasesKey).toBe(
      "commandPalette.aliases.equalizePanels"
    );
    expect(contribution?.when).toBe("workspace.groupCount > 1");
    if (!contribution) {
      throw new Error("missing equalize contribution");
    }

    const action = createActionFromContribution(contribution, runtime(2));

    expect(action.id).toBe("pier.panel.equalizeSplits");
    expect(action.category).toBe("Panel");
    expect(action.title()).toBe("commandPalette.action.equalizePanels");
    expect(action.metadata?.aliases?.()).toEqual([
      "平分面板",
      "balance panels",
      "junfen",
      "jfmb",
    ]);
    expect(action.metadata?.keywords).toBeUndefined();
  });

  it("evaluates workspace group count conditions", () => {
    expect(
      evaluateActionWhen("workspace.groupCount > 1", runtime(1).getContext())
    ).toBe(false);
    expect(
      evaluateActionWhen("workspace.groupCount > 1", runtime(2).getContext())
    ).toBe(true);
  });

  it("accepts conjunctions with or without spaces", () => {
    expect(
      evaluateActionWhen(
        "workspace.hasApi&&workspace.hasActivePanel",
        runtime(1).getContext()
      )
    ).toBe(true);
    expect(
      evaluateActionWhen(
        "workspace.hasApi && workspace.groupCount > 1",
        runtime(1).getContext()
      )
    ).toBe(false);
  });

  it("does not run disabled contribution actions", async () => {
    const handler = vi.fn();
    const contribution: ActionContribution = {
      categoryKey: "panel",
      handler,
      id: "pier.panel.disabled",
      surfaces: ["command-palette"],
      titleKey: "commandPalette.action.disabled",
      when: "workspace.groupCount > 1",
    };
    const action = createActionFromContribution(contribution, runtime(1));

    expect(action.enabled?.()).toBe(false);
    await action.handler();
    expect(handler).not.toHaveBeenCalled();
  });
});
