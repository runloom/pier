import type { MenuTemplate } from "@shared/contracts/menu.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPanelActions } from "@/lib/actions/panel-actions.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";
import {
  captureDomSelectionText,
  registerSelectionSelectAllProvider,
  registerSelectionTextProvider,
} from "@/lib/context-menu/selection-text.ts";
import { popupContextMenuAt } from "@/lib/context-menu/use-context-menu.ts";
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

describe("panel/content copy selection menu", () => {
  let disposeActions: (() => void) | undefined;
  const writeText = vi.fn(async (_text: string) => undefined);
  const popup = vi.fn(async () => ({ actionId: null as string | null }));

  beforeEach(() => {
    actionRegistry.clearForTests();
    disposeActions = registerPanelActions();
    writeText.mockClear();
    popup.mockClear();
    useWorkspaceStore.getState().setApi({
      activePanel: {
        id: "git-1",
        view: { contentComponent: "pier.git.changes" },
      },
      groups: [{ id: "g1" }, { id: "g2" }],
      panels: [],
    } as never);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        clipboard: { writeText },
        menu: { popup },
      },
    });
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: true,
      toString: () => "",
    } as Selection);
  });

  afterEach(() => {
    disposeActions?.();
    actionRegistry.clearForTests();
    vi.restoreAllMocks();
    useWorkspaceStore.getState().setApi(null);
  });

  it("always shows Copy and Select All on panel/content", () => {
    const entries = buildMenuEntries("panel/content", {
      surface: "panel/content",
    });
    const ids = collectActionIds(entries);
    expect(ids).toContain("pier.panel.copySelection");
    expect(ids).toContain("pier.panel.selectAll");
  });

  it("hides shared Copy on terminal content surface", () => {
    const terminal = buildMenuEntries("terminal/content", {
      surface: "terminal/content",
    });
    expect(collectActionIds(terminal)).not.toContain(
      "pier.panel.copySelection"
    );
  });

  it("hides shared Copy on files and git tree surfaces", () => {
    expect(
      collectActionIds(
        buildMenuEntries("files/tree-item", { surface: "files/tree-item" })
      )
    ).not.toContain("pier.panel.copySelection");
    expect(
      collectActionIds(
        buildMenuEntries("git/review-tree-item", {
          surface: "git/review-tree-item",
        })
      )
    ).not.toContain("pier.panel.copySelection");
  });

  it("captureDomSelectionText prefers a registered live provider", () => {
    const dispose = registerSelectionTextProvider(
      "git-1",
      () => "concurrency:\n  group: update"
    );
    expect(captureDomSelectionText("git-1")).toBe(
      "concurrency:\n  group: update"
    );
    dispose();
  });

  it("selectAll action runs a registered provider", async () => {
    const selectAll = vi.fn(() => true);
    const dispose = registerSelectionSelectAllProvider("git-1", selectAll);
    const action = actionRegistry.get("pier.panel.selectAll");
    expect(action).toBeDefined();
    await action?.handler({ sourcePanelId: "git-1", surface: "panel/content" });
    expect(selectAll).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("popupContextMenuAt pins live provider text onto Copy menu item", async () => {
    const dispose = registerSelectionTextProvider(
      "git-1",
      () => "jobs:\n  refresh:"
    );
    await popupContextMenuAt(
      "panel/content",
      { x: 12, y: 24 },
      { sourcePanelId: "git-1" }
    );
    dispose();
    expect(popup).toHaveBeenCalled();
    const calls = popup.mock.calls as unknown as [MenuTemplate, unknown?][];
    const template = calls[0]?.[0];
    expect(template).toBeDefined();
    if (!template) {
      throw new Error("expected menu template");
    }
    expect(collectActionIds(template)).toContain("pier.panel.copySelection");
    const copyItem = template.find(
      (entry) =>
        entry.type === "action" && entry.id === "pier.panel.copySelection"
    );
    expect(copyItem).toMatchObject({
      clipboardText: "jobs:\n  refresh:",
      id: "pier.panel.copySelection",
      type: "action",
    });
  });

  it("copy handler writes live provider text via pier.clipboard", async () => {
    const dispose = registerSelectionTextProvider(
      "git-1",
      () => "selected-diff-line"
    );
    const action = actionRegistry.get("pier.panel.copySelection");
    expect(action).toBeDefined();
    await action?.handler({ sourcePanelId: "git-1", surface: "panel/content" });
    dispose();
    expect(writeText).toHaveBeenCalledWith("selected-diff-line");
  });

  it("copy handler is silent when no selection is available", async () => {
    const action = actionRegistry.get("pier.panel.copySelection");
    expect(action).toBeDefined();
    await action?.handler({ surface: "panel/content" });
    expect(writeText).not.toHaveBeenCalled();
  });
});
