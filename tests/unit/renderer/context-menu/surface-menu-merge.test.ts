import type { MenuTemplate } from "@shared/contracts/menu.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerPanelActions } from "@/lib/actions/panel-actions.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function collectActionIds(entries: MenuTemplate): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry.type === "action") {
      ids.push(entry.id);
    } else if (entry.type === "submenu") {
      for (const child of entry.submenu) {
        if (child.type === "action") {
          ids.push(child.id);
        }
      }
    }
  }
  return ids;
}

const LAYOUT_IDS = [
  "pier.panel.equalizeSplits",
  "pier.panel.focusRight",
  "pier.panel.focusDown",
  "pier.panel.focusLeft",
  "pier.panel.focusUp",
] as const;

const EDIT_IDS = ["pier.panel.copySelection", "pier.panel.selectAll"] as const;

describe("context-menu surface merge with real panel actions", () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    actionRegistry.clearForTests();
    dispose = registerPanelActions();
    useWorkspaceStore.getState().setApi({
      activePanel: {
        id: "p1",
        view: { contentComponent: "workbench" },
      },
      groups: [
        { id: "g1", panels: [{ id: "p1" }] },
        { id: "g2", panels: [] },
      ],
      panels: [
        {
          id: "p1",
          view: { contentComponent: "workbench" },
        },
      ],
    } as never);
  });

  afterEach(() => {
    dispose?.();
    actionRegistry.clearForTests();
    useWorkspaceStore.getState().setApi(null);
  });

  it("panel/content includes shared edit and layout when multi-group", () => {
    const ids = collectActionIds(
      buildMenuEntries("panel/content", { surface: "panel/content" })
    );
    for (const id of EDIT_IDS) {
      expect(ids).toContain(id);
    }
    for (const id of LAYOUT_IDS) {
      expect(ids).toContain(id);
    }
  });

  it("hides layout actions when only one group", () => {
    useWorkspaceStore.getState().setApi({
      activePanel: {
        id: "p1",
        view: { contentComponent: "workbench" },
      },
      groups: [{ id: "g1", panels: [{ id: "p1" }] }],
      panels: [
        {
          id: "p1",
          view: { contentComponent: "workbench" },
        },
      ],
    } as never);
    const ids = collectActionIds(
      buildMenuEntries("panel/content", { surface: "panel/content" })
    );
    for (const id of LAYOUT_IDS) {
      expect(ids).not.toContain(id);
    }
    for (const id of EDIT_IDS) {
      expect(ids).toContain(id);
    }
  });

  it("files/tree-item has neither layout nor shared edit", () => {
    const ids = collectActionIds(
      buildMenuEntries("files/tree-item", { surface: "files/tree-item" })
    );
    for (const id of [...LAYOUT_IDS, ...EDIT_IDS]) {
      expect(ids).not.toContain(id);
    }
  });

  it("files/tree-background has neither layout nor shared edit", () => {
    const ids = collectActionIds(
      buildMenuEntries("files/tree-background", {
        surface: "files/tree-background",
      })
    );
    for (const id of [...LAYOUT_IDS, ...EDIT_IDS]) {
      expect(ids).not.toContain(id);
    }
  });

  it("git/review-tree-item has neither layout nor shared edit", () => {
    const ids = collectActionIds(
      buildMenuEntries("git/review-tree-item", {
        surface: "git/review-tree-item",
      })
    );
    for (const id of [...LAYOUT_IDS, ...EDIT_IDS]) {
      expect(ids).not.toContain(id);
    }
  });

  it("files/editor has neither layout nor shared edit", () => {
    const ids = collectActionIds(
      buildMenuEntries("files/editor", { surface: "files/editor" })
    );
    for (const id of [...LAYOUT_IDS, ...EDIT_IDS]) {
      expect(ids).not.toContain(id);
    }
  });

  it("files/canvas-preview has shared edit but no layout", () => {
    const ids = collectActionIds(
      buildMenuEntries("files/canvas-preview", {
        surface: "files/canvas-preview",
      })
    );
    for (const id of EDIT_IDS) {
      expect(ids).toContain(id);
    }
    for (const id of LAYOUT_IDS) {
      expect(ids).not.toContain(id);
    }
  });

  it("files/markdown-preview has shared edit but no layout", () => {
    const ids = collectActionIds(
      buildMenuEntries("files/markdown-preview", {
        surface: "files/markdown-preview",
      })
    );
    for (const id of EDIT_IDS) {
      expect(ids).toContain(id);
    }
    for (const id of LAYOUT_IDS) {
      expect(ids).not.toContain(id);
    }
  });

  it("terminal/content has layout when multi-group but not shared edit", () => {
    const ids = collectActionIds(
      buildMenuEntries("terminal/content", { surface: "terminal/content" })
    );
    for (const id of EDIT_IDS) {
      expect(ids).not.toContain(id);
    }
    for (const id of LAYOUT_IDS) {
      expect(ids).toContain(id);
    }
  });
});
