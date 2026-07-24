import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINAL_STATUS_OVERFLOW_PRIORITY,
  fitTerminalStatusOverflow,
  overflowPriorityForStatusItem,
  pinnedIdsFromOverflowDeclarations,
  resolveTerminalStatusOverflowPolicy,
} from "@/panel-kits/terminal/terminal-status-bar-overflow.ts";

describe("fitTerminalStatusOverflow", () => {
  const slots = [
    { id: "pier.worktree.status", priority: 0, width: 120 },
    { id: "pier.git.status.changes", priority: 30, width: 64 },
    { id: "pier.git.status.sync", priority: 20, width: 56 },
    { id: "pier.files.project", priority: 40, width: 40 },
  ];

  it("空间足够时不隐藏有内容的项", () => {
    expect(
      fitTerminalStatusOverflow({
        availableWidth: 400,
        gap: 4,
        hasFlexSpacer: true,
        pinnedIds: new Set(["pier.worktree.status"]),
        slots,
      })
    ).toEqual([]);
  });

  it("按 priority 先整项隐藏项目与更改", () => {
    // 120+64+56+40 + 4*4 gaps = 296；收紧到只够 branch+sync
    expect(
      fitTerminalStatusOverflow({
        availableWidth: 200,
        gap: 4,
        hasFlexSpacer: true,
        pinnedIds: new Set(["pier.worktree.status"]),
        slots,
      })
    ).toEqual(["pier.files.project", "pier.git.status.changes"]);
  });

  it("pinned 分支即使最宽也不因溢出隐藏", () => {
    expect(
      fitTerminalStatusOverflow({
        availableWidth: 50,
        gap: 4,
        hasFlexSpacer: true,
        pinnedIds: new Set(["pier.worktree.status"]),
        slots,
      })
    ).toEqual([
      "pier.files.project",
      "pier.git.status.changes",
      "pier.git.status.sync",
    ]);
  });

  it("width=0 的空槽一律 hidden，避免空壳占 flex gap", () => {
    expect(
      fitTerminalStatusOverflow({
        availableWidth: 100,
        gap: 4,
        hasFlexSpacer: true,
        pinnedIds: new Set(["pier.worktree.status"]),
        slots: [
          { id: "pier.worktree.status", priority: 0, width: 80 },
          { id: "pier.git.status.changes", priority: 30, width: 0 },
          { id: "pier.git.status.sync", priority: 20, width: 0 },
        ],
      })
    ).toEqual(["pier.git.status.changes", "pier.git.status.sync"]);
  });

  it("空壳 hidden 后 gap 只按有内容项计算，不再误藏", () => {
    // branch 80 + project 40 + spacer 计 2 个 gap = 80+40+8 = 128 ≤ 130
    expect(
      fitTerminalStatusOverflow({
        availableWidth: 130,
        gap: 4,
        hasFlexSpacer: true,
        pinnedIds: new Set(["pier.worktree.status"]),
        slots: [
          { id: "pier.worktree.status", priority: 0, width: 80 },
          { id: "pier.git.status.changes", priority: 30, width: 0 },
          { id: "pier.git.status.sync", priority: 20, width: 0 },
          { id: "pier.files.project", priority: 40, width: 40 },
        ],
      })
    ).toEqual(["pier.git.status.changes", "pier.git.status.sync"]);
  });
});

describe("overflow declarations", () => {
  const declared = new Map([
    ["pier.files.project", { overflowPriority: 40 }],
    ["pier.worktree.status", { overflowPinned: true, overflowPriority: 0 }],
    ["pier.git.status.changes", { overflowPriority: 30 }],
  ]);

  it("从贡献声明解析 priority / pinned，未知默认 25", () => {
    expect(overflowPriorityForStatusItem("pier.files.project", declared)).toBe(
      40
    );
    expect(
      overflowPriorityForStatusItem("pier.worktree.status", declared)
    ).toBe(0);
    expect(overflowPriorityForStatusItem("pier.custom.item", declared)).toBe(
      DEFAULT_TERMINAL_STATUS_OVERFLOW_PRIORITY
    );
    expect(
      resolveTerminalStatusOverflowPolicy("pier.worktree.status", declared)
    ).toEqual({ pinned: true, priority: 0 });
    expect(pinnedIdsFromOverflowDeclarations(declared)).toEqual(
      new Set(["pier.worktree.status"])
    );
  });
});
