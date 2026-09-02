import { describe, expect, it } from "vitest";
import type { Action, ActionCategoryKey } from "@/lib/actions/types.ts";
import {
  COMMAND_PALETTE_RECENTS_LIMIT,
  CREATE_MENU_CATEGORY_ORDER,
  commandListHasItemValue,
  commandListItemValue,
  compareCreateMenuItems,
  comparePaletteItems,
  firstCommandListItemValue,
  PALETTE_CATEGORY_ORDER,
  presentCommandListGroups,
  RECENT_PRESENTATION_ID,
} from "@/lib/command-palette/present-groups.ts";

function action(
  id: string,
  category: ActionCategoryKey,
  extras?: {
    excludeFromMru?: boolean;
    sortOrder?: number;
  }
): Action {
  return {
    category,
    handler: () => undefined,
    id,
    metadata: {
      categoryKey: category,
      ...(extras?.excludeFromMru ? { excludeFromMru: true } : {}),
      ...(extras?.sortOrder == null ? {} : { sortOrder: extras.sortOrder }),
    },
    title: () => id,
  };
}

function presentCreate(
  actions: readonly Action[],
  frecencyMap?: ReadonlyMap<string, number>
) {
  return presentCommandListGroups(actions, {
    categoryLabel: (category) => category,
    categoryOrder: CREATE_MENU_CATEGORY_ORDER,
    ...(frecencyMap ? { frecencyMap } : {}),
    itemCompare: compareCreateMenuItems,
    recentLabel: "recent",
    recentsLimit: 0,
  });
}

function presentPalette(
  actions: readonly Action[],
  frecencyMap: ReadonlyMap<string, number> = new Map()
) {
  return presentCommandListGroups(actions, {
    categoryLabel: (category) => category,
    categoryOrder: PALETTE_CATEGORY_ORDER,
    frecencyMap,
    itemCompare: comparePaletteItems,
    recentLabel: "recent",
    recentsLimit: COMMAND_PALETTE_RECENTS_LIMIT,
  });
}

describe("presentCommandListGroups", () => {
  it("merges singleton create-menu categories and omits headings", () => {
    const groups = presentCreate([
      action("pier.worktree.create", "worktree"),
      action("pier.panel.newTab", "panel"),
      action("pier.files.newFile", "file"),
      action("pier.window.newWindow", "window"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.heading).toBeNull();
    expect(groups[0]?.actions.map((item) => item.id)).toEqual([
      "pier.panel.newTab",
      "pier.files.newFile",
      "pier.worktree.create",
      "pier.window.newWindow",
    ]);
  });

  it("does not promote a high-frecency singleton group when recents are off", () => {
    const groups = presentCreate(
      [
        action("pier.worktree.create", "worktree"),
        action("pier.panel.newTab", "panel"),
        action("pier.files.newFile", "file"),
        action("pier.window.newWindow", "window"),
      ],
      new Map([["pier.worktree.create", 99]])
    );

    expect(groups[0]?.actions[0]?.id).toBe("pier.panel.newTab");
    expect(groups.some((group) => group.heading === "worktree")).toBe(false);
  });

  it("keeps category order stable and puts frecency only in recents", () => {
    const groups = presentPalette(
      [
        action("pier.view.zoomIn", "view", { sortOrder: 1 }),
        action("pier.view.zoomOut", "view", { sortOrder: 2 }),
        action("pier.settings.open", "settings", { sortOrder: 1 }),
        action("pier.settings.installCli", "settings", { sortOrder: 2 }),
        action("pier.worktree.create", "worktree"),
      ],
      new Map([["pier.worktree.create", 50]])
    );

    expect(groups[0]).toMatchObject({
      heading: null,
      id: RECENT_PRESENTATION_ID,
      separatorAfter: true,
    });
    expect(groups[0]?.actions.map((item) => item.id)).toEqual([
      "pier.worktree.create",
    ]);
    expect(groups.slice(1).map((group) => group.id)).toEqual([
      "view",
      "unheaded:0",
      "settings",
    ]);
    expect(groups[1]?.heading).toBe("view");
    expect(groups[2]?.heading).toBeNull();
    expect(groups[2]?.actions.map((item) => item.id)).toEqual([
      "pier.worktree.create",
    ]);
    expect(groups[3]?.heading).toBe("settings");
  });

  it("omits excludeFromMru actions from recents", () => {
    const groups = presentPalette(
      [
        action("pier.commandPalette.clearRecent", "settings", {
          excludeFromMru: true,
          sortOrder: 1,
        }),
        action("pier.settings.open", "settings", { sortOrder: 2 }),
      ],
      new Map([["pier.commandPalette.clearRecent", 80]])
    );

    expect(groups.some((group) => group.id === RECENT_PRESENTATION_ID)).toBe(
      false
    );
  });

  it("splits two or more agent starts into a headed agent group", () => {
    const groups = presentCreate([
      action("pier.panel.newTerminal", "run", { sortOrder: 1 }),
      action("pier.agent.start.claude", "run", { sortOrder: 10 }),
      action("pier.agent.start.codex", "run", { sortOrder: 11 }),
      action("pier.run.task", "run", { sortOrder: 0 }),
    ]);

    expect(groups.map((group) => group.id)).toEqual(["run", "agent"]);
    expect(groups[0]?.heading).toBe("run");
    expect(groups[0]?.actions.map((item) => item.id)).toEqual([
      "pier.panel.newTerminal",
      "pier.run.task",
    ]);
    expect(groups[1]?.heading).toBe("agent");
    expect(groups[1]?.actions.map((item) => item.id)).toEqual([
      "pier.agent.start.claude",
      "pier.agent.start.codex",
    ]);
  });

  it("keeps a single agent start in run", () => {
    const groups = presentCreate([
      action("pier.panel.newTerminal", "run"),
      action("pier.agent.start.claude", "run", { sortOrder: 10 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe("run");
    expect(groups[0]?.heading).toBe("run");
    expect(groups[0]?.actions.map((item) => item.id)).toEqual([
      "pier.panel.newTerminal",
      "pier.agent.start.claude",
    ]);
  });

  it("drops an empty run bucket after extracting agents", () => {
    const groups = presentCreate([
      action("pier.agent.start.claude", "run", { sortOrder: 10 }),
      action("pier.agent.start.codex", "run", { sortOrder: 11 }),
    ]);

    expect(groups.map((group) => group.id)).toEqual(["agent"]);
    expect(groups[0]?.heading).toBe("agent");
  });

  it("does not merge unheaded buckets across a headed group", () => {
    const groups = presentPalette([
      action("pier.workspace.resetLayout", "workspace"),
      action("pier.git.commit", "git", { sortOrder: 1 }),
      action("pier.git.stash", "git", { sortOrder: 2 }),
      action("pier.window.newWindow", "window"),
    ]);

    expect(
      groups.map((group) => ({ heading: group.heading, id: group.id }))
    ).toEqual([
      { heading: null, id: "unheaded:0" },
      { heading: "git", id: "git" },
      { heading: null, id: "unheaded:1" },
    ]);
    expect(groups[0]?.actions.map((item) => item.id)).toEqual([
      "pier.workspace.resetLayout",
    ]);
    expect(groups[2]?.actions.map((item) => item.id)).toEqual([
      "pier.window.newWindow",
    ]);
  });

  it("uses metadata category keys for plugin actions", () => {
    const pluginAction: Action = {
      category: "Worktree",
      handler: () => undefined,
      id: "pier.worktree.create",
      metadata: { categoryKey: "worktree" },
      title: () => "Create Worktree",
    };
    const groups = presentCreate([pluginAction]);
    expect(groups[0]?.heading).toBeNull();
    expect(groups[0]?.actions[0]?.id).toBe("pier.worktree.create");
  });

  it("gives recents and category copies distinct cmdk values", () => {
    const groups = presentPalette(
      [
        action("pier.view.zoomIn", "view", { sortOrder: 1 }),
        action("pier.view.zoomOut", "view", { sortOrder: 2 }),
      ],
      new Map([["pier.view.zoomIn", 9]])
    );
    const values = groups.flatMap((group) =>
      group.actions.map((item) => commandListItemValue(group.id, item.id))
    );
    expect(values).toEqual([
      "recent:pier.view.zoomIn",
      "view:pier.view.zoomIn",
      "view:pier.view.zoomOut",
    ]);
    expect(new Set(values).size).toBe(values.length);
    expect(firstCommandListItemValue(groups)).toBe("recent:pier.view.zoomIn");
    expect(commandListHasItemValue(groups, "view:pier.view.zoomOut")).toBe(
      true
    );
    expect(commandListHasItemValue(groups, "pier.view.zoomIn")).toBe(false);
  });
});
