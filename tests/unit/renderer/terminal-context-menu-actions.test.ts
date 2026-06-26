import type { MenuTemplate } from "@shared/contracts/menu.ts";
import i18next from "i18next";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function terminalPanel(id: string) {
  return {
    id,
    title: "Terminal",
    view: { contentComponent: "terminal" },
  };
}

function webPanel(id: string) {
  return {
    id,
    title: "Welcome",
    view: { contentComponent: "welcome" },
  };
}

function createApi(
  activePanel: ReturnType<typeof terminalPanel | typeof webPanel>
) {
  return {
    activeGroup: { panels: [activePanel] },
    activePanel,
    groups: [{ id: "group-1" }],
    panels: [activePanel],
    totalPanels: 1,
  };
}

function collectActionIds(items: MenuTemplate): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.type === "action") {
      ids.push(item.id);
      continue;
    }
    if (item.type === "submenu") {
      ids.push(...collectActionIds(item.submenu));
    }
  }
  return ids;
}

function topLevelActionLabels(items: MenuTemplate): string[] {
  return items
    .filter((item) => item.type === "action")
    .map((item) => (item.type === "action" ? item.label : ""));
}

describe("terminal content context menu actions", () => {
  const disposers: Array<() => void> = [];
  const performOperation = vi.fn(async () => ({ ok: true }));

  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(async () => {
    await i18next.changeLanguage("zh-CN");
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          performOperation,
        },
      },
    });
    performOperation.mockClear();
    useWorkspaceStore
      .getState()
      .setApi(createApi(terminalPanel("terminal-1")) as never);
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
    useWorkspaceStore.getState().setApi(null);
  });

  async function registerActions(): Promise<void> {
    const { registerPanelActions } = await import(
      "@/lib/actions/panel-actions.ts"
    );
    const { registerTerminalActions } = await import(
      "@/panel-kits/terminal/register-actions.ts"
    );
    disposers.push(registerPanelActions());
    disposers.push(registerTerminalActions());
  }

  it("adds terminal editing actions to the top of terminal/content", async () => {
    await registerActions();

    const entries = buildMenuEntries("terminal/content");
    const ids = collectActionIds(entries);

    expect(ids).toEqual(
      expect.arrayContaining([
        "pier.terminal.copy",
        "pier.terminal.paste",
        "pier.terminal.selectAll",
        "pier.terminal.clearScreen",
        "pier.panel.splitRight",
        "pier.panel.focusRight",
      ])
    );
    expect(ids.slice(0, 4)).toEqual([
      "pier.terminal.copy",
      "pier.terminal.paste",
      "pier.terminal.selectAll",
      "pier.terminal.clearScreen",
    ]);
    expect(topLevelActionLabels(entries).slice(0, 4)).toEqual([
      "复制",
      "粘贴",
      "全选",
      "清屏",
    ]);
  });

  it("does not expose terminal-only actions on the dockview tab menu", async () => {
    await registerActions();

    const ids = collectActionIds(buildMenuEntries("dockview-tab"));

    expect(ids).not.toEqual(
      expect.arrayContaining([
        "pier.terminal.clearScreen",
        "pier.panel.splitRight",
        "pier.panel.focusRight",
      ])
    );
  });

  it("dispatches terminal operations against the active terminal panel", async () => {
    await registerActions();

    const action = actionRegistry.get("pier.terminal.clearScreen");
    if (!action) {
      throw new Error("missing pier.terminal.clearScreen action");
    }

    await action.handler();

    expect(performOperation).toHaveBeenCalledWith("terminal-1", "clearScreen");
  });

  it("does not dispatch terminal operations for non-terminal active panels", async () => {
    await registerActions();
    useWorkspaceStore
      .getState()
      .setApi(createApi(webPanel("welcome-1")) as never);

    const action = actionRegistry.get("pier.terminal.copy");
    if (!action) {
      throw new Error("missing pier.terminal.copy action");
    }

    await action.handler();

    expect(performOperation).not.toHaveBeenCalled();
  });
});
