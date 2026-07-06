import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDialogHost } from "@/components/common/app-dialog-host.tsx";
import { initI18n } from "@/i18n/index.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import {
  resetAppDialogForTests,
  showAppAlert,
  showAppConfirm,
} from "@/stores/app-dialog.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import {
  getLastTerminalInputRoutingSnapshot,
  resetTerminalInputRoutingForTests,
} from "@/stores/terminal-input-routing-slice.ts";

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
  });

  afterEach(() => {
    act(() => {
      resetAppDialogForTests();
    });
    cleanup();
  });

  it("confirm 弹窗点确认按钮 resolve true", async () => {
    render(<AppDialogHost />);

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
    render(<AppDialogHost />);

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
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await expect(result).resolves.toBe(false);
  });

  it("危险确认弹窗使用小尺寸媒体样式和危险按钮", async () => {
    render(<AppDialogHost />);

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
    render(<AppDialogHost />);

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

  it("打开期间注册 blocking overlay 与 keybinding scope,关闭后释放", async () => {
    render(<AppDialogHost />);

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
    render(<AppDialogHost />);

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
    render(<AppDialogHost />);

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
