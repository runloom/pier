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
import {
  resetAppDialogForTests,
  showAppAlert,
  showAppConfirm,
} from "@/stores/app-dialog.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import {
  getLastTerminalInputRoutingSnapshot,
  resetTerminalInputRoutingForTests,
} from "@/stores/terminal-input-routing.store.ts";

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
      result = showAppConfirm({ confirmLabel: "Go", title: "Rebase Branch" });
    });

    expect(await screen.findByText("Rebase Branch")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await expect(result).resolves.toBe(false);
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
      result = showAppConfirm({ confirmLabel: "Go", title: "Routing Check" });
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

  it("新弹窗替换旧弹窗,旧的按取消 resolve false", async () => {
    render(<AppDialogHost />);

    let first: Promise<boolean> | undefined;
    act(() => {
      first = showAppConfirm({ confirmLabel: "A", title: "First Dialog" });
    });
    expect(await screen.findByText("First Dialog")).toBeVisible();

    let second: Promise<boolean> | undefined;
    act(() => {
      second = showAppConfirm({ confirmLabel: "B", title: "Second Dialog" });
    });

    await expect(first).resolves.toBe(false);
    expect(await screen.findByText("Second Dialog")).toBeVisible();
    expect(screen.queryByText("First Dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "B" }));
    await expect(second).resolves.toBe(true);
  });
});
