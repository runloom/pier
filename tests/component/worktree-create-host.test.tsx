import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorktreeCreateHost } from "@/components/common/worktree-create-host.tsx";
import { initI18n } from "@/i18n/index.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { resetTerminalInputRoutingForTests } from "@/stores/terminal-input-routing.store.ts";
import {
  closeWorktreeCreatePanel,
  openWorktreeCreatePanel,
} from "@/stores/worktree-create.store.ts";

const createMock = vi.fn();
const WORKTREE_LABEL_RE = /worktree/i;

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
  createMock.mockResolvedValue({
    copiedFiles: [],
    created: {
      bare: false,
      branch: "wt/fix-focus",
      detached: false,
      head: "def",
      isCurrent: false,
      isMain: false,
      locked: false,
      lockedReason: null,
      path: "/repo/.worktrees/fix-focus",
      prunable: false,
      prunableReason: null,
    },
    targetPath: "/repo/.worktrees/fix-focus",
    worktrees: [],
  });
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      git: {
        listBranches: vi.fn().mockResolvedValue([
          {
            isCurrent: true,
            kind: "local",
            lastCommit: "abc",
            name: "main",
            upstream: null,
          },
        ]),
      },
      onWindowLayoutPulse: vi.fn(() => vi.fn()),
      preferences: {
        read: vi.fn().mockResolvedValue({
          worktreeBranchPrefix: "wt/",
          worktreeCopyPatterns: [".env*"],
          worktreeSetupCommand: "pnpm setup:worktree",
        }),
      },
      terminal: {
        applyInputRouting: vi.fn(),
        open: vi.fn().mockResolvedValue(null),
      },
      worktrees: {
        create: createMock,
        list: vi.fn().mockResolvedValue({
          currentPath: "/repo",
          mainPath: "/repo",
          path: "/repo",
          status: "available",
          worktrees: [
            {
              bare: false,
              branch: "main",
              detached: false,
              head: "abc",
              isCurrent: true,
              isMain: true,
              locked: false,
              lockedReason: null,
              path: "/repo",
              prunable: false,
              prunableReason: null,
            },
          ],
        }),
      },
    },
  });
});

afterEach(() => {
  closeWorktreeCreatePanel();
  cleanup();
  vi.clearAllMocks();
});

describe("WorktreeCreateHost", () => {
  it("输入描述后展示推导的分支与位置;Enter 提交 create", async () => {
    render(<WorktreeCreateHost />);
    await openWorktreeCreatePanel({ path: "/repo" });

    const input = await screen.findByRole("textbox", {
      name: WORKTREE_LABEL_RE,
    });
    fireEvent.change(input, { target: { value: "fix focus bug" } });
    expect(
      await screen.findByDisplayValue("wt/fix-focus-bug")
    ).toBeInTheDocument();
    expect(screen.getByText(".worktrees/fix-focus-bug")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        branch: "wt/fix-focus-bug",
        name: "fix-focus-bug",
        path: "/repo",
      });
    });
  });
});
