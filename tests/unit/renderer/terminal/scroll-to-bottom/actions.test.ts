import type { TerminalOperationResult } from "@shared/contracts/terminal.ts";
import i18next from "i18next";
import { toast } from "sonner";
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
import { popupContextMenuAt } from "@/lib/context-menu/use-menu.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import { registerTerminalLayoutAnchor } from "@/panel-kits/terminal/layout-coordinator.ts";
import { registerTerminalActions } from "@/panel-kits/terminal/register-actions.ts";
import {
  resetAppDialogForTests,
  useAppDialogStore,
} from "@/stores/app-dialog.store.ts";
import { registerTerminalComposerTakeover } from "@/stores/terminal-composer-takeover.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const actionId = "pier.terminal.scrollToBottom";

function panel(id: string, contentComponent = "terminal") {
  return { id, title: id, view: { contentComponent } };
}

function setPanels(
  activePanel = panel("terminal-a"),
  others: ReturnType<typeof panel>[] = []
) {
  const panels = [activePanel, ...others];
  useWorkspaceStore.getState().setApi({
    activeGroup: { panels },
    activePanel,
    groups: [{ id: "group-1" }],
    panels,
    totalPanels: panels.length,
  } as never);
}

function action() {
  const registered = actionRegistry.get(actionId);
  if (!registered) throw new Error("scroll to bottom action is missing");
  return registered;
}

describe("terminal scroll to bottom action", () => {
  const disposers: Array<() => void> = [];
  const performOperation = vi.fn<() => Promise<TerminalOperationResult>>();

  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(async () => {
    await i18next.changeLanguage("zh-CN");
    performOperation.mockReset().mockResolvedValue({ ok: true });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        menu: { popup: vi.fn(async () => ({ actionId })) },
        terminal: {
          onSearchOpenRequest: vi.fn(() => () => undefined),
          performOperation,
        },
      },
    });
    setPanels();
    const anchor = registerTerminalLayoutAnchor(
      "terminal-a",
      document.createElement("div")
    );
    disposers.push(anchor.dispose);
    disposers.push(registerTerminalActions());
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
    resetAppDialogForTests();
    useWorkspaceStore.getState().setApi(null);
    vi.restoreAllMocks();
  });

  it("exposes one command in the terminal menu and palette without promoting clipboard commands", () => {
    for (const surface of ["terminal/content", "command-palette"]) {
      expect(
        actionRegistry.list(surface).filter((item) => item.id === actionId)
      ).toHaveLength(1);
    }
    expect(action().title()).toBe("回到底部");
    const paletteIds = actionRegistry
      .list("command-palette")
      .map((item) => item.id);
    for (const id of [
      "pier.terminal.copy",
      "pier.terminal.paste",
      "pier.terminal.selectAll",
      "pier.terminal.clearScreen",
    ]) {
      expect(paletteIds).not.toContain(id);
    }
    for (const surface of [
      "terminal/restored",
      "dockview-tab",
      "files/tree",
      "files/editor",
    ]) {
      expect(actionRegistry.list(surface).map((item) => item.id)).not.toContain(
        actionId
      );
    }
    expect(keybindingRegistry.getFirstBindingFor(actionId)).toBeUndefined();
  });

  it("places navigation after find and before clearing or closing", () => {
    const ids = buildMenuEntries("terminal/content", {
      sourcePanelId: "terminal-a",
      surface: "terminal/content",
    }).flatMap((item) => (item.type === "action" ? [item.id] : []));
    expect(ids[0]).toBe("pier.terminal.copy");
    expect(ids.indexOf(actionId)).toBeGreaterThan(
      ids.indexOf("pier.terminal.search")
    );
    expect(ids.indexOf(actionId)).toBeLessThan(
      ids.indexOf("pier.terminal.clearScreen")
    );
    expect(ids.indexOf(actionId)).toBeLessThan(
      ids.indexOf("pier.terminal.close")
    );
  });

  it("uses the clicked terminal even when another panel is active", async () => {
    setPanels(panel("terminal-a"), [panel("terminal-b")]);
    const anchor = registerTerminalLayoutAnchor(
      "terminal-b",
      document.createElement("div")
    );
    disposers.push(anchor.dispose);
    await popupContextMenuAt(
      "terminal/content",
      { x: 10, y: 20 },
      { sourcePanelId: "terminal-b" }
    );
    expect(performOperation).toHaveBeenCalledExactlyOnceWith(
      "terminal-b",
      "scrollToBottom"
    );
  });

  it("uses the active terminal from the palette without closing rich input or adding a toast", async () => {
    const isOpen = vi.fn(() => true);
    disposers.push(registerTerminalComposerTakeover("terminal-a", isOpen));
    const eventSpy = vi.spyOn(window, "dispatchEvent");
    const successSpy = vi.spyOn(toast, "success");
    await action().handler({ surface: "command-palette" });
    expect(performOperation).toHaveBeenCalledExactlyOnceWith(
      "terminal-a",
      "scrollToBottom"
    );
    expect(eventSpy).not.toHaveBeenCalled();
    expect(isOpen).not.toHaveBeenCalled();
    expect(successSpy).not.toHaveBeenCalled();
    expect(useAppDialogStore.getState().current).toBeNull();
  });

  it("disables the palette command when the active panel is not a terminal", async () => {
    setPanels(panel("files-a", "files"), [panel("terminal-b")]);
    expect(action().enabled?.()).toBe(false);
    await action().handler({ surface: "command-palette" });
    expect(performOperation).not.toHaveBeenCalled();
  });

  it("disables a terminal without a native viewport while another terminal remains available", async () => {
    setPanels(panel("terminal-restored"), [panel("terminal-a")]);
    expect(action().enabled?.()).toBe(false);
    await action().handler({ surface: "command-palette" });
    expect(performOperation).not.toHaveBeenCalled();

    setPanels(panel("terminal-a"), [panel("terminal-restored")]);
    expect(action().enabled?.()).toBe(true);
    expect(action().enabled?.({ sourcePanelId: "terminal-restored" })).toBe(
      false
    );
    await action().handler({
      sourcePanelId: "terminal-restored",
      surface: "terminal/content",
    });
    expect(performOperation).not.toHaveBeenCalled();
    expect(useAppDialogStore.getState().current).toBeNull();
  });

  it("rechecks viewport availability when executing an already opened menu", async () => {
    setPanels(panel("terminal-temporary"));
    const anchor = registerTerminalLayoutAnchor(
      "terminal-temporary",
      document.createElement("div")
    );
    expect(action().enabled?.()).toBe(true);
    anchor.dispose();

    expect(action().enabled?.()).toBe(false);
    await action().handler({
      sourcePanelId: "terminal-temporary",
      surface: "terminal/content",
    });
    expect(performOperation).not.toHaveBeenCalled();
  });

  it("does not fall back to the active terminal when the clicked panel was closed", async () => {
    expect(action().enabled?.({ sourcePanelId: "closed-terminal" })).toBe(
      false
    );
    await action().handler({
      sourcePanelId: "closed-terminal",
      surface: "terminal/content",
    });
    expect(performOperation).not.toHaveBeenCalled();
  });

  it.each([
    "result",
    "rejection",
  ])("shows one detailed alert for an IPC %s failure", async (failure) => {
    if (failure === "result") {
      performOperation.mockResolvedValue({
        error: "surface disposed",
        ok: false,
      });
    } else {
      performOperation.mockRejectedValue(new Error("surface disposed"));
    }
    const alerts: string[] = [];
    disposers.push(
      useAppDialogStore.subscribe(({ current }) => {
        if (current) alerts.push(current.title);
      })
    );
    const completed = Promise.resolve(action().handler()).catch(
      (error: unknown) => error
    );
    await vi.waitFor(() =>
      expect(useAppDialogStore.getState().current).toMatchObject({
        body: "surface disposed",
        kind: "alert",
        title: i18next.t("contextMenu.action.terminalOperationFailed"),
      })
    );
    const current = useAppDialogStore.getState().current;
    if (current?.kind === "alert") current.resolve(true);
    expect(await completed).toBeUndefined();
    expect(alerts).toHaveLength(1);
    expect(performOperation).toHaveBeenCalledTimes(1);
  });
});
