import { TerminalOverlayContext } from "@pier/ui/use-terminal-overlay.tsx";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDialogHost } from "@/components/common/app-dialog-host.tsx";
import { initI18n } from "@/i18n/index.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import {
  resetAppDialogForTests,
  showAppAlert,
  showAppChoice,
  showAppConfirm,
  showAppPrompt,
} from "@/stores/app-dialog.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import {
  getLastTerminalInputRoutingSnapshot,
  registerTerminalElementWebOverlay,
  resetTerminalInputRoutingForTests,
} from "@/stores/terminal-input-routing-slice.ts";

const terminalOverlayRegistry = {
  registerElement: registerTerminalElementWebOverlay,
};

function renderHost(children: ReactNode = <AppDialogHost />) {
  return render(
    <TerminalOverlayContext.Provider value={terminalOverlayRegistry}>
      {children}
    </TerminalOverlayContext.Provider>
  );
}

describe("AppDialogHost", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetTerminalInputRoutingForTests();
    await initI18n();
    await i18next.changeLanguage("en");
    useKeybindingScope.setState({
      activePanelComponent: null,
      activePanelId: null,
      activePanelKind: null,
      overlayStack: [],
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        onWindowLayoutPulse: vi.fn(() => vi.fn()),
        terminal: { applyInputRouting: vi.fn() },
      },
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 720,
      height: 696,
      left: 0,
      right: 1280,
      toJSON: () => ({}),
      top: 24,
      width: 1280,
      x: 0,
      y: 24,
    });
  });

  afterEach(() => {
    act(() => {
      resetAppDialogForTests();
    });
    cleanup();
    vi.restoreAllMocks();
  });

  it("confirm 弹窗点确认按钮 resolve true", async () => {
    renderHost();

    let result: Promise<boolean> | undefined;
    act(() => {
      result = showAppConfirm({
        body: "Delete worktree feature-x?",
        confirmLabel: "Delete",
        intent: "destructive",
        size: "sm",
        title: "Delete Worktree",
      });
    });

    expect(await screen.findByText("Delete Worktree")).toBeVisible();
    expect(screen.getByText("Delete worktree feature-x?")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await expect(result).resolves.toBe(true);
  });

  it("confirm 弹窗默认取消按钮走宿主 i18n 并 resolve false", async () => {
    renderHost();

    let result: Promise<boolean> | undefined;
    act(() => {
      result = showAppConfirm({
        confirmLabel: "Go",
        intent: "default",
        size: "sm",
        title: "Rebase Branch",
      });
    });

    expect(await screen.findByText("Rebase Branch")).toBeVisible();
    const dialog = screen.getByRole("alertdialog");
    let resolvedValue: boolean | undefined;
    result?.then((value) => {
      resolvedValue = value;
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(dialog).toHaveAttribute("data-state", "closed");
    expect(dialog).toHaveClass("data-closed:animate-out");
    await act(() => Promise.resolve());
    expect(resolvedValue).toBe(false);
    await expect(result).resolves.toBe(false);
    expect(screen.queryByText("Rebase Branch")).not.toBeInTheDocument();
  });

  it("危险确认弹窗使用小尺寸媒体样式和危险按钮", async () => {
    renderHost();

    let result: Promise<boolean> | undefined;
    act(() => {
      result = showAppConfirm({
        body: "Quitting will terminate these processes.",
        confirmLabel: "Quit",
        intent: "destructive",
        size: "sm",
        title: "Quit Pier?",
      });
    });

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAttribute("data-size", "sm");
    expect(
      dialog.querySelector('[data-slot="alert-dialog-media"]')
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute(
      "data-variant",
      "ghost"
    );
    expect(screen.getByRole("button", { name: "Quit" })).toHaveAttribute(
      "data-variant",
      "destructive"
    );

    fireEvent.click(screen.getByRole("button", { name: "Quit" }));
    await expect(result).resolves.toBe(true);
  });

  it("alert 弹窗只有 OK 按钮且点击后 resolve", async () => {
    renderHost();

    let result: Promise<void> | undefined;
    act(() => {
      result = showAppAlert({
        body: "fatal: not a git repository",
        title: "Git operation failed",
      });
    });

    expect(await screen.findByText("Git operation failed")).toBeVisible();
    expect(screen.getByText("fatal: not a git repository")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Cancel" })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    await expect(result).resolves.toBeUndefined();
  });

  it("choice 弹窗立即返回所选操作并独立退场", async () => {
    renderHost();

    let result: Promise<"alt" | "cancel" | "confirm"> | undefined;
    act(() => {
      result = showAppChoice({
        altLabel: "Discard",
        confirmLabel: "Save",
        intent: "destructive",
        size: "sm",
        title: "Save changes?",
      });
    });

    expect(await screen.findByText("Save changes?")).toBeVisible();
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(dialog).toHaveAttribute("data-state", "closed");
    await expect(result).resolves.toBe("alt");
  });

  it("prompt 弹窗立即返回输入值并独立退场", async () => {
    renderHost();

    let result: Promise<string | null> | undefined;
    act(() => {
      result = showAppPrompt({
        confirmLabel: "Save",
        initialValue: "old-name",
        intent: "default",
        size: "sm",
        title: "Rename",
      });
    });

    const input = await screen.findByRole("textbox", { name: "Rename" });
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(input, { target: { value: "new-name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(dialog).toHaveAttribute("data-state", "closed");
    await expect(result).resolves.toBe("new-name");
  });

  it("打开期间注册 blocking overlay 与 keybinding scope,关闭后释放", async () => {
    renderHost();

    let result: Promise<boolean> | undefined;
    act(() => {
      result = showAppConfirm({
        confirmLabel: "Go",
        intent: "default",
        size: "sm",
        title: "Routing Check",
      });
    });

    expect(await screen.findByText("Routing Check")).toBeVisible();
    expect(getLastTerminalInputRoutingSnapshot()).toEqual(
      expect.objectContaining({
        webOverlayRects: expect.arrayContaining([
          expect.objectContaining({ id: "app-dialog" }),
        ]),
        webRequestCount: 1,
      })
    );
    expect(useKeybindingScope.getState().overlayStack).toContain(
      "overlay:app-dialog"
    );

    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await result;

    await waitFor(() => {
      expect(getLastTerminalInputRoutingSnapshot()).toEqual(
        expect.objectContaining({
          webOverlayRects: [],
          webRequestCount: 0,
        })
      );
    });
    expect(useKeybindingScope.getState().overlayStack).not.toContain(
      "overlay:app-dialog"
    );
  });

  it("弹窗出现时关闭仍开着的命令面板,不与面板叠放", async () => {
    renderHost();

    act(() => {
      useCommandPaletteController.getState().openPalette();
    });
    expect(useCommandPaletteController.getState().open).toBe(true);

    let result: Promise<void> | undefined;
    act(() => {
      result = showAppAlert({
        body: "fatal: no rebase in progress",
        title: "Git 操作失败",
      });
    });

    expect(useCommandPaletteController.getState().open).toBe(false);
    expect(await screen.findByText("Git 操作失败")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await expect(result).resolves.toBeUndefined();
  });

  it("新弹窗替换旧弹窗,旧的按取消 resolve false", async () => {
    renderHost();

    let first: Promise<boolean> | undefined;
    act(() => {
      first = showAppConfirm({
        confirmLabel: "A",
        intent: "default",
        size: "sm",
        title: "First Dialog",
      });
    });
    expect(await screen.findByText("First Dialog")).toBeVisible();

    let second: Promise<boolean> | undefined;
    act(() => {
      second = showAppConfirm({
        confirmLabel: "B",
        intent: "default",
        size: "sm",
        title: "Second Dialog",
      });
    });

    await expect(first).resolves.toBe(false);
    expect(await screen.findByText("Second Dialog")).toBeVisible();
    expect(screen.queryByText("First Dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "B" }));
    await expect(second).resolves.toBe(true);
  });
});
