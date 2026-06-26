import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { registerRunActions } from "@/lib/actions/run-actions.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

describe("run actions", () => {
  let disposeRunActions: (() => void) | null = null;

  beforeEach(async () => {
    await initI18n();
    vi.restoreAllMocks();
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
    useWorkspaceStore.getState().setApi(null);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          focusSession: vi.fn(async () => ({ ok: true })),
          listSessions: vi.fn(async () => ({
            errors: [],
            open: [
              {
                active: true,
                cwd: "/Users/xyz/ABC/pier",
                groupIndex: 0,
                panelId: "terminal-current",
                recordId: "record-main",
                tabCount: 2,
                tabIndex: 0,
                title: "pier",
                windowFocused: true,
                windowId: "main",
                windowIndex: 0,
              },
              {
                active: false,
                cwd: "/Users/xyz/ABC/loomdesk",
                groupIndex: 0,
                panelId: "terminal-other",
                recordId: "record-main",
                tabCount: 2,
                tabIndex: 1,
                title: "loomdesk",
                windowFocused: true,
                windowId: "main",
                windowIndex: 0,
              },
              {
                active: true,
                cwd: "/Users/xyz/ABC/bay",
                groupIndex: 1,
                panelId: "terminal-bay",
                recordId: "record-secondary",
                tabCount: 1,
                tabIndex: 0,
                title: "bay",
                windowFocused: false,
                windowId: "secondary",
                windowIndex: 1,
              },
            ],
            recentClosed: [
              {
                closedAt: "2026-06-25T10:00:00.000Z",
                cwd: "/Users/xyz/ABC/pier",
                id: "terminal-closed:2026-06-25T10:00:00.000Z",
                panelId: "terminal-closed",
                recordId: "record-main",
                title: "Claude Code",
                windowAlive: true,
                windowId: "main",
              },
            ],
          })),
          openSession: vi.fn(async () => ({ ok: true })),
        },
      },
    });
  });

  afterEach(() => {
    disposeRunActions?.();
    disposeRunActions = null;
    useWorkspaceStore.getState().setApi(null);
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
    vi.restoreAllMocks();
  });

  it("opens a grouped terminal list from all windows", async () => {
    useWorkspaceStore.getState().setApi({} as never);
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.terminalList")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    expect(quickPick?.title).toBe("终端列表...");
    expect(quickPick?.sections?.map((section) => section.heading)).toEqual([
      "窗口 1 · 当前窗口 · 第 1 组",
      "窗口 2 · 第 2 组",
      "最近关闭",
    ]);
    expect(quickPick?.sections?.[0]?.items.map((item) => item.label)).toEqual([
      "pier",
      "loomdesk",
    ]);
    expect(quickPick?.sections?.[0]?.items[0]?.checked).toBe(true);
    expect(quickPick?.sections?.[1]?.items[0]?.checked).not.toBe(true);
    expect(quickPick?.sections?.[0]?.items[0]?.badges).toEqual([
      { label: "标签 1/2", variant: "outline" },
    ]);
    expect(quickPick?.sections?.[0]?.items[1]?.badges).toEqual([
      { label: "标签 2/2", variant: "outline" },
    ]);
    expect(quickPick?.sections?.[2]?.items[0]?.badges).toEqual([
      { label: "已关闭", variant: "secondary" },
    ]);
    expect(quickPick?.items).toBeUndefined();
  });

  it("sorts terminal rows by window, group, and tab position before rendering", async () => {
    useWorkspaceStore.getState().setApi({} as never);
    vi.mocked(window.pier.terminal.listSessions).mockResolvedValueOnce({
      errors: [],
      open: [
        {
          active: false,
          cwd: "/tmp/b",
          groupIndex: 1,
          panelId: "terminal-b",
          recordId: "record-main",
          tabCount: 2,
          tabIndex: 1,
          title: "b",
          windowFocused: true,
          windowId: "main",
          windowIndex: 0,
        },
        {
          active: true,
          cwd: "/tmp/a",
          groupIndex: 0,
          panelId: "terminal-a",
          recordId: "record-main",
          tabCount: 2,
          tabIndex: 0,
          title: "a",
          windowFocused: true,
          windowId: "main",
          windowIndex: 0,
        },
      ],
      recentClosed: [],
    });
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.terminalList")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    expect(quickPick?.sections?.map((section) => section.heading)).toEqual([
      "窗口 1 · 当前窗口 · 第 1 组",
      "窗口 1 · 当前窗口 · 第 2 组",
    ]);
    expect(
      quickPick?.sections?.flatMap((section) =>
        section.items.map((item) => item.label)
      )
    ).toEqual(["a", "b"]);
  });

  it("renders terminal list errors as a disabled section", async () => {
    useWorkspaceStore.getState().setApi({} as never);
    vi.mocked(window.pier.terminal.listSessions).mockResolvedValueOnce({
      errors: [
        {
          message: "renderer command timed out",
          recordId: "record-secondary",
          windowId: "secondary",
        },
      ],
      open: [],
      recentClosed: [],
    });
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.terminalList")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    expect(quickPick?.sections?.map((section) => section.heading)).toEqual([
      "错误",
    ]);
    expect(quickPick?.sections?.[0]?.items[0]).toMatchObject({
      disabled: true,
      id: "terminal-error:0",
      label: "renderer command timed out",
    });
  });

  it("focuses an existing terminal from the terminal list", async () => {
    useWorkspaceStore.getState().setApi({} as never);
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.terminalList")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.id === "terminal:secondary:terminal-bay");
    if (!(quickPick && target)) {
      throw new Error("expected secondary terminal item");
    }

    await quickPick.onAccept(target);

    expect(window.pier.terminal.focusSession).toHaveBeenCalledWith({
      panelId: "terminal-bay",
      windowId: "secondary",
    });
  });

  it("propagates terminal focus failures from the terminal list", async () => {
    useWorkspaceStore.getState().setApi({} as never);
    vi.mocked(window.pier.terminal.focusSession).mockResolvedValueOnce({
      error: "window not found",
      ok: false,
    });
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.terminalList")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.id === "terminal:secondary:terminal-bay");
    if (!(quickPick && target)) {
      throw new Error("expected secondary terminal item");
    }

    await expect(quickPick.onAccept(target)).rejects.toThrow(
      "window not found"
    );
  });

  it("reopens a recent closed terminal through the owning window when possible", async () => {
    useWorkspaceStore.getState().setApi({} as never);
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.terminalList")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    const recentItem = quickPick?.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.id.startsWith("recent:"));
    if (!(quickPick && recentItem)) {
      throw new Error("expected recent terminal item");
    }

    await quickPick.onAccept(recentItem);

    expect(window.pier.terminal.openSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/Users/xyz/ABC/pier",
        windowId: "main",
      })
    );
  });
});
