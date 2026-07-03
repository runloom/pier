import { describe, expect, it, vi } from "vitest";
import {
  createActionFromContribution,
  evaluateActionWhen,
} from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { PANEL_TAB_FOCUS_ACTION_CONTRIBUTIONS } from "@/lib/actions/panel-actions.ts";
import { PANEL_LAYOUT_ACTION_CONTRIBUTIONS } from "@/lib/actions/panel-layout-contributions.ts";

function runtime(groupCount: number, activeIsTaskPanel = false) {
  return {
    getContext: () => ({
      terminal: {
        activeIsTaskPanel,
        hasActivePanel: true,
      },
      workspace: {
        activeGroupPanelCount: 1,
        groupCount,
        hasActivePanel: true,
        hasApi: true,
        panelCount: groupCount,
      },
    }),
    resolveAliases: (actionId: string) =>
      actionId === "pier.panel.equalizeSplits"
        ? ["平分面板", "balance panels", "junfen", "jfmb"]
        : [],
    t: (key: string) => key,
  };
}

function runtimeWithParams() {
  return {
    ...runtime(1),
    t: (key: string, params?: Record<string, number | string>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
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

  it("keeps dockview tab close menu scoped to the current group", () => {
    const dockviewTabActions = PANEL_LAYOUT_ACTION_CONTRIBUTIONS.filter(
      (action) => action.surfaces.includes("dockview-tab")
    );
    const closeAction = dockviewTabActions.find(
      (action) => action.id === "pier.panel.close"
    );

    expect(dockviewTabActions.map((action) => action.id)).toEqual([
      "pier.panel.close",
      "pier.panel.closeOthers",
    ]);
    expect(closeAction?.shortcutSourceId).toBe("pier.panel.closeActive");
  });

  it("builds runtime actions from contribution metadata and aliases", () => {
    const contribution = PANEL_LAYOUT_ACTION_CONTRIBUTIONS.find(
      (action) => action.id === "pier.panel.equalizeSplits"
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
  });

  it("evaluates workspace group count conditions", () => {
    expect(
      evaluateActionWhen("workspace.groupCount > 1", runtime(1).getContext())
    ).toBe(false);
    expect(
      evaluateActionWhen("workspace.groupCount > 1", runtime(2).getContext())
    ).toBe(true);
  });

  it("evaluates terminal active panel conditions", () => {
    expect(
      evaluateActionWhen("terminal.hasActivePanel", runtime(1).getContext())
    ).toBe(true);
  });

  it("evaluates negated boolean conditions", () => {
    expect(
      evaluateActionWhen(
        "!terminal.activeIsTaskPanel",
        runtime(1, false).getContext()
      )
    ).toBe(true);
    expect(
      evaluateActionWhen(
        "!terminal.activeIsTaskPanel",
        runtime(1, true).getContext()
      )
    ).toBe(false);
    expect(
      evaluateActionWhen("!workspace.hasApi", runtime(1).getContext())
    ).toBe(false);
  });

  it("maps menuHiddenWhen to metadata.menuHidden", () => {
    const contribution: ActionContribution = {
      categoryKey: "run",
      handler: () => undefined,
      id: "pier.test.menuHidden",
      menuHiddenWhen: "terminal.activeIsTaskPanel",
      surfaces: ["terminal/content"],
      titleKey: "contextMenu.action.rerunTask",
    };

    expect(
      createActionFromContribution(
        contribution,
        runtime(1, true)
      ).metadata?.menuHidden?.()
    ).toBe(true);
    expect(
      createActionFromContribution(
        contribution,
        runtime(1, false)
      ).metadata?.menuHidden?.()
    ).toBe(false);
  });

  it("declares numbered tab focus actions as parameterized contributions", () => {
    expect(
      PANEL_TAB_FOCUS_ACTION_CONTRIBUTIONS.map((action) => action.id)
    ).toEqual([
      "pier.panel.focusTab1",
      "pier.panel.focusTab2",
      "pier.panel.focusTab3",
      "pier.panel.focusTab4",
      "pier.panel.focusTab5",
      "pier.panel.focusTab6",
      "pier.panel.focusTab7",
      "pier.panel.focusTab8",
      "pier.panel.focusTab9",
    ]);

    const action = createActionFromContribution(
      PANEL_TAB_FOCUS_ACTION_CONTRIBUTIONS[1] as ActionContribution,
      runtimeWithParams()
    );

    expect(action.title()).toBe('commandPalette.action.focusTab:{"index":2}');
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
