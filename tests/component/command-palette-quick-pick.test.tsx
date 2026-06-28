import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/components/common/command-palette.tsx";
import { initI18n } from "@/i18n/index.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";

class TestResizeObserver {
  observe() {
    // Test no-op.
  }
  unobserve() {
    // Test no-op.
  }
  disconnect() {
    // Test no-op.
  }
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
      } as never);
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
});
