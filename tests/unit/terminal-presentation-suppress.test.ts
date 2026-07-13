import type {
  TerminalFrame,
  TerminalPresentationReason,
} from "@shared/contracts/terminal.ts";
import { describe, expect, it } from "vitest";
import {
  buildTerminalPresentationFacts,
  type TerminalPresentationWorkspaceState,
} from "@/panel-kits/terminal/terminal-presentation-reconciler.ts";

const REASON: TerminalPresentationReason = "visibility";
const FRAME: TerminalFrame = { height: 80, width: 120, x: 0, y: 0 };

function workspaceWith(panelIds: string[]): TerminalPresentationWorkspaceState {
  const [first] = panelIds;
  return {
    activePanelId: first ?? null,
    activeTerminalPanelId: first ?? null,
    hasMaximizedGroup: false,
    panels: panelIds.map((id) => ({
      component: "terminal",
      dockviewActive: id === first,
      dockviewVisible: true,
      id,
    })),
  };
}

describe("buildTerminalPresentationFacts suppressVisible", () => {
  it("默认（未抑制）：可见终端 visible=true", () => {
    const snapshot = buildTerminalPresentationFacts({
      readFrame: () => FRAME,
      reason: REASON,
      workspace: workspaceWith(["t1"]),
    });
    expect(snapshot.terminals[0]?.visible).toBe(true);
  });

  it("suppressVisible=true：所有终端 visible=false 且 frame=null（避免 native 每帧 applyHostFrame 抖动）", () => {
    const snapshot = buildTerminalPresentationFacts({
      readFrame: () => FRAME,
      reason: REASON,
      suppressVisible: true,
      workspace: workspaceWith(["t1", "t2"]),
    });
    expect(snapshot.terminals).toHaveLength(2);
    for (const term of snapshot.terminals) {
      expect(term.visible).toBe(false);
      // frame=null：native 跳过 applyHostFrame，直接隐身，不触发同步 Metal 重渲染。
      expect(term.frame).toBeNull();
    }
  });

  it("suppressVisible=false 显式传入：等同默认（回归保护）", () => {
    const snapshot = buildTerminalPresentationFacts({
      readFrame: () => FRAME,
      reason: REASON,
      suppressVisible: false,
      workspace: workspaceWith(["t1"]),
    });
    expect(snapshot.terminals[0]?.visible).toBe(true);
  });
});
