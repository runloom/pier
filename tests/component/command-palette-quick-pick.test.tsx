import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/components/common/command-palette.tsx";
import { initI18n } from "@/i18n/index.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";

class TestResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

const originalScrollIntoView = Element.prototype.scrollIntoView;

describe("CommandPalette quick pick rows", () => {
  beforeEach(async () => {
    await initI18n();
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    Element.prototype.scrollIntoView = vi.fn();
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          applyInputRouting: vi.fn(),
        },
      },
    });
  });

  afterEach(() => {
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalScrollIntoView) {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    } else {
      (
        Element.prototype as {
          scrollIntoView?: Element["scrollIntoView"] | undefined;
        }
      ).scrollIntoView = undefined;
    }
  });

  it("shows item detail as secondary row text and keeps description as the action hint", async () => {
    render(<CommandPalette />);

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        title: "Switch Terminal",
        placeholder: "Search terminals",
        items: [
          {
            badges: [
              { label: "第 1 组", variant: "outline" },
              { label: "标签 1/2", variant: "outline" },
            ],
            description: "切换",
            detail: "/Users/xyz/ABC/pier",
            id: "terminal-1",
            label: "pier",
          },
        ],
        onAccept: vi.fn(),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("pier")).toBeVisible();
    });
    expect(screen.getByText("第 1 组")).toBeVisible();
    expect(screen.getByText("标签 1/2")).toBeVisible();
    expect(screen.getByText("/Users/xyz/ABC/pier")).toBeVisible();

    const row = screen.getByText("pier").closest("[cmdk-item]");
    expect(row).toHaveTextContent("切换");
  });

  it("constrains long quick-pick descriptions so task rows do not overflow", async () => {
    render(<CommandPalette />);
    const longDescription =
      "bun run kit:sync && LOOMDESK_BUILD_DEV=1 electron-vite build --config src-electron/electron.vite.config.ts";

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        title: "Run Task",
        placeholder: "Search tasks",
        items: [
          {
            badges: [{ label: "package.json", variant: "secondary" }],
            description: longDescription,
            detail: "bun run electron:build:dev",
            id: "package-script:electron:build:dev",
            label: "electron:build:dev",
          },
        ],
        onAccept: vi.fn(),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("electron:build:dev")).toBeVisible();
    });
    expect(screen.getByText("package.json")).toBeVisible();
    expect(screen.getByText("bun run electron:build:dev")).toBeVisible();

    const description = screen.getByText(longDescription);
    expect(description).toHaveClass(
      "min-w-0",
      "max-w-[45%]",
      "shrink",
      "truncate",
      "text-right"
    );
  });

  it("renders quick-pick sections with headings", async () => {
    render(<CommandPalette />);

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        title: "Terminal List",
        placeholder: "Search terminals",
        sections: [
          {
            heading: "窗口 1 · 第 1 组",
            id: "window-1-group-1",
            items: [
              {
                badges: [{ label: "标签 1/2", variant: "outline" }],
                checked: true,
                detail: "/Users/xyz/ABC/pier",
                id: "terminal-1",
                label: "pier",
              },
            ],
          },
          {
            heading: "最近关闭",
            id: "recent",
            items: [
              {
                badges: [{ label: "已关闭", variant: "secondary" }],
                description: "重新打开",
                detail: "/Users/xyz/ABC/pier · 刚刚",
                id: "recent-1",
                label: "Claude Code",
              },
            ],
          },
        ],
        onAccept: vi.fn(),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("窗口 1 · 第 1 组")).toBeVisible();
    });
    expect(screen.getByText("pier")).toBeVisible();
    expect(screen.getByText("标签 1/2")).toBeVisible();
    expect(screen.getByText("最近关闭")).toBeVisible();
    expect(screen.getByText("已关闭")).toBeVisible();
    expect(screen.getByText("重新打开")).toBeVisible();
    expect(screen.getByText("pier").closest("[cmdk-item]")).toHaveAttribute(
      "aria-current",
      "true"
    );
  });

  it("marks disabled command actions as disabled and shows the reason", async () => {
    const dispose = actionRegistry.register({
      category: "Worktree",
      disabledReason: () => "Worktree creation is not available yet",
      enabled: () => false,
      handler: vi.fn(),
      id: "test.worktree.create",
      surfaces: ["command-palette"],
      title: () => "Worktree: Create",
    });
    render(<CommandPalette />);

    act(() => {
      useCommandPaletteController.getState().openPalette();
    });

    await waitFor(() => {
      expect(screen.getByText("Worktree: Create")).toBeVisible();
    });
    expect(
      screen.getByText("Worktree: Create").closest("[cmdk-item]")
    ).toHaveAttribute("data-disabled", "true");
    expect(
      screen.getByText("Worktree creation is not available yet")
    ).toBeVisible();

    dispose();
  });

  it("filters quick-pick items by i18n aliases", async () => {
    render(<CommandPalette />);

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        title: "Select Language",
        placeholder: "Search languages",
        items: [
          {
            aliases: ["jianti", "zhongwen", "中文"],
            id: "locale:zh-CN",
            label: "简体中文",
          },
          {
            aliases: ["english", "yingwen"],
            id: "locale:en",
            label: "English",
          },
        ],
        onAccept: vi.fn(),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("简体中文")).toBeVisible();
    });
    fireEvent.change(screen.getByPlaceholderText("Search languages"), {
      target: { value: "jianti" },
    });

    await waitFor(() => {
      expect(screen.getByText("简体中文")).toBeVisible();
    });
    expect(screen.queryByText("English")).not.toBeInTheDocument();
  });

  it("filters grouped quick-pick items by dynamic search terms", async () => {
    render(<CommandPalette />);

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        title: "Terminal List",
        placeholder: "Search terminals",
        sections: [
          {
            heading: "Window 1 · Group 1",
            id: "group-1",
            items: [
              {
                detail: "/Users/xyz/ABC/pier",
                id: "panel:terminal-1",
                label: "pier",
                searchTerms: ["terminal-1", "main"],
              },
              {
                detail: "/Users/xyz/ABC/loomdesk",
                id: "panel:terminal-2",
                label: "workspace",
                searchTerms: ["terminal-2", "loomdesk", "agent-run"],
              },
            ],
          },
        ],
        onAccept: vi.fn(),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("pier")).toBeVisible();
    });
    fireEvent.change(screen.getByPlaceholderText("Search terminals"), {
      target: { value: "agent-run" },
    });

    await waitFor(() => {
      expect(screen.getByText("workspace")).toBeVisible();
    });
    expect(screen.queryByText("pier")).not.toBeInTheDocument();
  });

  it("closes immediately when accepting a quick-pick item starts slow async work", async () => {
    render(<CommandPalette />);
    let resolveAccept!: () => void;
    const accepted = new Promise<void>((resolve) => {
      resolveAccept = resolve;
    });
    const onAccept = vi.fn(() => accepted);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        title: "Run Task",
        placeholder: "Search tasks",
        items: [
          {
            id: "package-script:test",
            label: "test",
          },
        ],
        onAccept,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("test")).toBeVisible();
    });
    const row = screen.getByText("test").closest("[cmdk-item]");
    expect(row).toBeInstanceOf(HTMLElement);

    act(() => {
      fireEvent.click(row as HTMLElement);
    });

    const wasOpenWhileAcceptPending =
      useCommandPaletteController.getState().open;
    const wasItemVisibleWhileAcceptPending =
      screen.queryByText("test") !== null;

    await act(async () => {
      resolveAccept();
      await accepted;
    });

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(wasOpenWhileAcceptPending).toBe(false);
    expect(wasItemVisibleWhileAcceptPending).toBe(false);

    expect(useCommandPaletteController.getState().open).toBe(false);
    expect(screen.queryByText("test")).not.toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("preserves quick-pick back stack when pending async accept opens a follow-up picker", async () => {
    render(<CommandPalette />);
    let resolveAccept!: () => void;
    const accepted = new Promise<void>((resolve) => {
      resolveAccept = resolve;
    });
    const onAccept = vi.fn(() => accepted);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        title: "Run Task",
        placeholder: "Search tasks",
        items: [
          {
            id: "package-script:test",
            label: "test",
          },
        ],
        onAccept,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("test")).toBeVisible();
    });
    const row = screen.getByText("test").closest("[cmdk-item]");
    expect(row).toBeInstanceOf(HTMLElement);

    act(() => {
      fireEvent.click(row as HTMLElement);
    });

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(useCommandPaletteController.getState().open).toBe(false);
    expect(screen.queryByText("test")).not.toBeInTheDocument();

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        title: "Choose Input",
        placeholder: "Choose a value",
        items: [
          {
            id: "choice",
            label: "choice",
          },
        ],
        onAccept: vi.fn(),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("choice")).toBeVisible();
    });

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    await waitFor(() => {
      expect(screen.getByText("test")).toBeVisible();
    });
    expect(screen.queryByText("choice")).not.toBeInTheDocument();

    await act(async () => {
      resolveAccept();
      await accepted;
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("preserves nested async accept back stack across two follow-up quick-picks", async () => {
    render(<CommandPalette />);
    let resolveAccept!: () => void;
    const accepted = new Promise<void>((resolve) => {
      resolveAccept = resolve;
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const selectedInputs: string[] = [];
    const onAccept = vi.fn(async () => {
      await Promise.resolve();
      try {
        const first = await new Promise<string | null>((resolve) => {
          useCommandPaletteController.getState().openQuickPick({
            title: "Choose First Input",
            placeholder: "Choose first input",
            items: [
              {
                id: "first",
                label: "first",
              },
            ],
            onAccept: (item) => {
              selectedInputs.push(item.id);
              resolve(item.id);
            },
            onDismiss: () => {
              resolve(null);
            },
          });
        });
        if (first === null) {
          return;
        }
        await Promise.resolve();
        await new Promise<string | null>((resolve) => {
          useCommandPaletteController.getState().openQuickPick({
            title: "Choose Second Input",
            placeholder: "Choose second input",
            items: [
              {
                id: "second",
                label: "second",
              },
            ],
            onAccept: (item) => {
              selectedInputs.push(item.id);
              resolve(item.id);
            },
            onDismiss: () => {
              resolve(null);
            },
          });
        });
      } finally {
        await accepted;
      }
    });

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        title: "Run Task",
        placeholder: "Search tasks",
        items: [
          {
            id: "task",
            label: "task",
          },
        ],
        onAccept,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("task")).toBeVisible();
    });
    const taskRow = screen.getByText("task").closest("[cmdk-item]");
    expect(taskRow).toBeInstanceOf(HTMLElement);

    act(() => {
      fireEvent.click(taskRow as HTMLElement);
    });

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(useCommandPaletteController.getState().open).toBe(false);
    expect(screen.queryByText("task")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("first")).toBeVisible();
    });
    const firstRow = screen.getByText("first").closest("[cmdk-item]");
    expect(firstRow).toBeInstanceOf(HTMLElement);

    act(() => {
      fireEvent.click(firstRow as HTMLElement);
    });

    expect(screen.queryByText("first")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("second")).toBeVisible();
    });

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    await waitFor(() => {
      expect(screen.getByText("first")).toBeVisible();
    });
    expect(screen.queryByText("second")).not.toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    await waitFor(() => {
      expect(screen.getByText("task")).toBeVisible();
    });
    expect(screen.queryByText("first")).not.toBeInTheDocument();

    await act(async () => {
      resolveAccept();
      await accepted;
    });

    expect(selectedInputs).toEqual(["first"]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("clears pending accepted picker stack before the next unrelated quick-pick opens", async () => {
    render(<CommandPalette />);
    let resolveAccept!: () => void;
    const accepted = new Promise<void>((resolve) => {
      resolveAccept = resolve;
    });
    const onAccept = vi.fn(() => accepted);
    const onDismiss = vi.fn();
    const unrelatedDismiss = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        title: "Run Task",
        placeholder: "Search tasks",
        items: [
          {
            id: "package-script:test",
            label: "test",
          },
        ],
        onAccept,
        onDismiss,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("test")).toBeVisible();
    });
    const row = screen.getByText("test").closest("[cmdk-item]");
    expect(row).toBeInstanceOf(HTMLElement);

    act(() => {
      fireEvent.click(row as HTMLElement);
    });

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(useCommandPaletteController.getState().open).toBe(false);
    expect(screen.queryByText("test")).not.toBeInTheDocument();

    await act(async () => {
      resolveAccept();
      await accepted;
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        title: "Unrelated Picker",
        placeholder: "Search unrelated",
        items: [
          {
            id: "unrelated",
            label: "unrelated",
          },
        ],
        onAccept: vi.fn(),
        onDismiss: unrelatedDismiss,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("unrelated")).toBeVisible();
    });

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    await waitFor(() => {
      expect(useCommandPaletteController.getState().open).toBe(false);
    });
    expect(screen.queryByText("unrelated")).not.toBeInTheDocument();
    expect(screen.queryByText("test")).not.toBeInTheDocument();
    expect(unrelatedDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("logs rejected async accepts without dismissing the accepted picker after it already closed", async () => {
    render(<CommandPalette />);
    let rejectAccept!: (error: Error) => void;
    const accepted = new Promise<void>((_resolve, reject) => {
      rejectAccept = reject;
    });
    const onAccept = vi.fn(() => accepted);
    const onDismiss = vi.fn();
    const rejection = new Error("boom");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        title: "Run Task",
        placeholder: "Search tasks",
        items: [
          {
            id: "package-script:test",
            label: "test",
          },
        ],
        onAccept,
        onDismiss,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("test")).toBeVisible();
    });
    const row = screen.getByText("test").closest("[cmdk-item]");
    expect(row).toBeInstanceOf(HTMLElement);

    act(() => {
      fireEvent.click(row as HTMLElement);
    });

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(useCommandPaletteController.getState().open).toBe(false);
    expect(screen.queryByText("test")).not.toBeInTheDocument();

    await act(async () => {
      rejectAccept(rejection);
      await accepted.catch(() => undefined);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "[command-palette] onAccept threw:",
        rejection
      );
    });
    expect(useCommandPaletteController.getState().open).toBe(false);
    expect(screen.queryByText("test")).not.toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("preserves a typed quick-pick query when loading rows are replaced", async () => {
    const dispose = actionRegistry.register({
      category: "Run",
      handler: vi.fn(),
      id: "test.previous-command",
      surfaces: ["command-palette"],
      title: () => "Previous Command Anchor",
    });

    try {
      render(<CommandPalette />);

      act(() => {
        useCommandPaletteController.getState().openPalette();
      });

      await waitFor(() => {
        expect(screen.getByText("Previous Command Anchor")).toBeVisible();
      });

      const loadingQuickPick = {
        title: "Run Task",
        placeholder: "Search tasks",
        loading: true,
        items: [
          {
            disabled: true,
            id: "task-loading",
            label: "Finding tasks...",
          },
        ],
        onAccept: vi.fn(),
      };

      act(() => {
        useCommandPaletteController.getState().openQuickPick(loadingQuickPick);
      });

      await waitFor(() => {
        expect(screen.getByText("Finding tasks...")).toBeVisible();
      });
      act(() => {
        fireEvent.change(screen.getByPlaceholderText("Search tasks"), {
          target: { value: "test" },
        });
      });
      expect(screen.getByPlaceholderText("Search tasks")).toHaveValue("test");

      const replaceQuickPick =
        useCommandPaletteController.getState().replaceQuickPick;

      act(() => {
        replaceQuickPick({
          title: "Run Task",
          placeholder: "Search tasks",
          sections: [
            {
              heading: "package.json",
              id: "package-script",
              items: [
                {
                  detail: "pnpm run test",
                  id: "package-script:test",
                  label: "test",
                },
                {
                  detail: "pnpm run build",
                  id: "package-script:build",
                  label: "build",
                },
              ],
            },
          ],
          onAccept: vi.fn(),
        });
      });

      await waitFor(() => {
        expect(screen.getByText("test")).toBeVisible();
      });
      expect(screen.getByPlaceholderText("Search tasks")).toHaveValue("test");
      expect(screen.queryByText("build")).not.toBeInTheDocument();

      act(() => {
        fireEvent.keyDown(document, { key: "Escape" });
      });

      await waitFor(() => {
        expect(useCommandPaletteController.getState().mode).toBe("commands");
      });
      expect(screen.getByText("Previous Command Anchor")).toBeVisible();
      expect(screen.queryByText("Finding tasks...")).not.toBeInTheDocument();
    } finally {
      act(() => {
        useCommandPaletteController.setState({
          mode: "commands",
          open: false,
          quickPick: null,
          requestId: 0,
          stack: [],
        });
      });
      dispose();
    }
  });

  it("replaces an open quick-pick without creating a new session or back-stack entry", async () => {
    const dispose = actionRegistry.register({
      category: "Run",
      handler: vi.fn(),
      id: "test.replace-contract-anchor",
      surfaces: ["command-palette"],
      title: () => "Replace Contract Anchor",
    });

    try {
      render(<CommandPalette />);

      act(() => {
        useCommandPaletteController.getState().openPalette();
      });

      await waitFor(() => {
        expect(screen.getByText("Replace Contract Anchor")).toBeVisible();
      });

      const loadingQuickPick = {
        title: "Run Task",
        placeholder: "Search tasks",
        loading: true,
        items: [
          {
            disabled: true,
            id: "task-loading",
            label: "Finding tasks...",
          },
        ],
        onAccept: vi.fn(),
      };

      act(() => {
        useCommandPaletteController.getState().openQuickPick(loadingQuickPick);
      });

      await waitFor(() => {
        expect(screen.getByText("Finding tasks...")).toBeVisible();
      });

      const beforeReplace = useCommandPaletteController.getState();
      expect(beforeReplace.requestId).toBe(2);
      expect(beforeReplace.stack).toHaveLength(1);
      expect(beforeReplace.stack.at(-1)?.mode).toBe("commands");

      act(() => {
        useCommandPaletteController.getState().replaceQuickPick({
          title: "Run Task",
          placeholder: "Search tasks",
          items: [
            {
              id: "package-script:test",
              label: "test",
            },
          ],
          onAccept: vi.fn(),
        });
      });

      await waitFor(() => {
        expect(screen.getByText("test")).toBeVisible();
      });

      const afterReplace = useCommandPaletteController.getState();
      expect(afterReplace.requestId).toBe(beforeReplace.requestId);
      expect(afterReplace.stack).toEqual(beforeReplace.stack);
      expect(afterReplace.quickPick?.items?.[0]?.id).toBe(
        "package-script:test"
      );

      act(() => {
        fireEvent.keyDown(document, { key: "Escape" });
      });

      await waitFor(() => {
        expect(useCommandPaletteController.getState().mode).toBe("commands");
      });
      expect(screen.getByText("Replace Contract Anchor")).toBeVisible();
      expect(screen.queryByText("Finding tasks...")).not.toBeInTheDocument();
      expect(screen.queryByText("test")).not.toBeInTheDocument();
    } finally {
      act(() => {
        useCommandPaletteController.setState({
          mode: "commands",
          open: false,
          quickPick: null,
          requestId: 0,
          stack: [],
        });
      });
      dispose();
    }
  });
});
