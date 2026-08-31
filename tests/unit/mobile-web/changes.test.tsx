/**
 * S2 变更：路由 cwd、单文件懒加载、真实 diff 行、大 hunk 截断。
 */
import type { GitDiffPatch, GitStatus } from "@shared/contracts/git.ts";
import type { ControlSnapshotPayload } from "@shared/contracts/local-control/control-snapshot.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIFF_HUNK_LINE_LIMIT } from "../../../apps/mobile-web/src/components/unified-diff.tsx";
import { useMobileWebStore } from "../../../apps/mobile-web/src/lib/store.ts";
import { ChangesPage } from "../../../apps/mobile-web/src/pages/changes.tsx";

const { commandMock } = vi.hoisted(() => ({ commandMock: vi.fn() }));

vi.mock("../../../apps/mobile-web/src/lib/session.ts", () => ({
  getMobileClient: () => ({ command: commandMock }),
}));

function statusFixture(): GitStatus {
  return {
    branch: {
      ahead: 1,
      behind: 0,
      branch: "feat",
      mergedIntoDefault: null,
      oid: "abc",
      upstream: "origin/feat",
      upstreamGone: false,
    },
    changeSummary: {
      changedFiles: 1,
      deletions: 1,
      excludedFiles: 0,
      insertions: 2,
      kind: "lineDelta",
    },
    counts: { conflict: 0, modified: 1, staged: 0, untracked: 0 },
    files: [
      { index: " ", origPath: null, path: "src/a.ts", worktree: "M" },
      { index: " ", origPath: null, path: "src/b.ts", worktree: "M" },
    ],
    remoteSync: null,
    repoState: { kind: "clean" },
    stashCount: 0,
  };
}

function patchFixture(lineCount = 3): GitDiffPatch {
  const lines = [
    { kind: "context" as const, text: "keep" },
    { kind: "del" as const, text: "old" },
    { kind: "add" as const, text: "new" },
    ...Array.from({ length: Math.max(0, lineCount - 3) }, (_, index) => ({
      kind: "add" as const,
      text: `extra-${index}`,
    })),
  ];
  return {
    files: [
      {
        binary: false,
        hunks: [
          {
            lines,
            newLines: lines.filter((line) => line.kind !== "del").length,
            newStart: 1,
            oldLines: 2,
            oldStart: 1,
          },
        ],
        oldPath: null,
        path: "src/a.ts",
      },
    ],
  };
}

describe("ChangesPage", () => {
  beforeEach(() => {
    commandMock.mockReset();
    window.location.hash = "#/changes?cwd=/session-wt";
    useMobileWebStore.setState({
      snapshot: {
        worktrees: [{ path: "/heuristic-wt", canonicalPath: "/heuristic-wt" }],
      } as unknown as ControlSnapshotPayload,
    });
    commandMock.mockImplementation((command: { type: string }) => {
      if (command.type === "git.getStatus") {
        return Promise.resolve(statusFixture());
      }
      return Promise.resolve(patchFixture());
    });
  });

  afterEach(() => {
    cleanup();
    useMobileWebStore.setState({ snapshot: null });
    window.location.hash = "";
  });

  it("git 报错时不再停在读取中", async () => {
    commandMock.mockRejectedValueOnce(
      new Error(
        "fatal: not a git repository (or any of the parent directories): .git"
      )
    );
    render(<ChangesPage />);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "当前目录不是 git 仓库"
      );
    });
    expect(screen.queryByText("读取中…")).toBeNull();
  });

  it("使用路由 cwd，列表阶段不拉 diff", async () => {
    render(<ChangesPage />);
    await waitFor(() => {
      expect(screen.getByTestId("changes-cwd").textContent).toBe("/session-wt");
    });
    expect(screen.getAllByTestId("git-file")[0]?.textContent).toContain(
      "src/a.ts"
    );
    expect(screen.getAllByTestId("git-file")[0]?.textContent).toContain("M");
    const types = commandMock.mock.calls.map(
      (call: unknown[]) => (call[0] as { type: string }).type
    );
    expect(types).toEqual(["git.getStatus"]);
  });

  it("后点的文件覆盖先点的迟到 diff", async () => {
    let resolveA: ((value: GitDiffPatch) => void) | undefined;
    commandMock.mockImplementation(
      (command: { type: string; options?: { paths?: string[] } }) => {
        if (command.type === "git.getStatus") {
          return Promise.resolve(statusFixture());
        }
        const path = command.options?.paths?.[0];
        if (path === "src/a.ts") {
          return new Promise<GitDiffPatch>((resolve) => {
            resolveA = resolve;
          });
        }
        return Promise.resolve({
          files: [
            {
              binary: false,
              hunks: [
                {
                  lines: [{ kind: "add" as const, text: "from-b" }],
                  newLines: 1,
                  newStart: 1,
                  oldLines: 0,
                  oldStart: 1,
                },
              ],
              oldPath: null,
              path: "src/b.ts",
            },
          ],
        });
      }
    );
    render(<ChangesPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId("git-file")).toHaveLength(2);
    });
    fireEvent.click(screen.getAllByTestId("git-file")[0] as HTMLElement);
    await waitFor(() => {
      expect(screen.getByTestId("git-diff-back")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("git-diff-back"));
    await waitFor(() => {
      expect(screen.getAllByTestId("git-file")).toHaveLength(2);
    });
    fireEvent.click(screen.getAllByTestId("git-file")[1] as HTMLElement);
    await waitFor(() => {
      expect(screen.getByTestId("git-diff").textContent).toContain("from-b");
    });
    resolveA?.(patchFixture());
    await Promise.resolve();
    expect(screen.getByTestId("git-diff").textContent).toContain("from-b");
    expect(screen.getByTestId("git-diff").textContent).not.toContain("+new");
  });

  it("点文件懒加载单文件 diff 并渲染 add/del/context 行", async () => {
    render(<ChangesPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId("git-file")[0]).toBeDefined();
    });
    fireEvent.click(screen.getAllByTestId("git-file")[0] as HTMLElement);
    await waitFor(() => {
      expect(screen.getByTestId("git-diff")).toBeDefined();
    });
    const diffCall = commandMock.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as { type: string }).type === "git.getDiffPatch"
    )?.[0] as {
      cwd: string;
      options: { paths: string[] };
      type: string;
    };
    expect(diffCall.cwd).toBe("/session-wt");
    expect(diffCall.options.paths).toEqual(["src/a.ts"]);
    expect(screen.getByTestId("diff-line-add").textContent).toContain("+new");
    expect(screen.getByTestId("diff-line-del").textContent).toContain("-old");
    expect(screen.getByTestId("diff-line-context").textContent).toContain(
      " keep"
    );
  });

  it("大 hunk 超过上限则截断并标注", async () => {
    commandMock.mockImplementation((command: { type: string }) => {
      if (command.type === "git.getStatus") {
        return Promise.resolve(statusFixture());
      }
      return Promise.resolve(patchFixture(DIFF_HUNK_LINE_LIMIT + 5));
    });
    render(<ChangesPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId("git-file")[0]).toBeDefined();
    });
    fireEvent.click(screen.getAllByTestId("git-file")[0] as HTMLElement);
    await waitFor(() => {
      expect(screen.getByTestId("diff-truncated")).toBeDefined();
    });
    expect(screen.getAllByTestId("diff-line-add").length).toBeLessThanOrEqual(
      DIFF_HUNK_LINE_LIMIT
    );
  });
});
