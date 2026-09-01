import type { ControlSnapshotPayload } from "@shared/contracts/local-control/control-snapshot.ts";
import { describe, expect, it } from "vitest";
import { buildProjectableGroups } from "../../../apps/mobile-web/src/lib/projectable-panels.ts";

function snapshot(
  partial: Partial<ControlSnapshotPayload>
): ControlSnapshotPayload {
  return {
    activity: [],
    agents: [],
    bootId: "boot",
    capturedAt: 1,
    notifications: [],
    panels: [],
    revision: 1,
    runtimes: [],
    tasks: [],
    windows: [],
    worktrees: [],
    ...partial,
  };
}

describe("buildProjectableGroups", () => {
  it("groups terminals / changes / docs and skips unknown components", () => {
    const groups = buildProjectableGroups(
      snapshot({
        agents: [
          {
            agentId: "codex",
            panelId: "agent-1",
            windowId: "w1",
            status: "ready",
            cwd: "/repo",
          },
        ],
        activity: [
          {
            kind: "agent",
            panelId: "agent-1",
            status: "ready",
            windowId: "w1",
          },
        ],
        panels: [
          {
            panelId: "agent-1",
            windowId: "w1",
            component: "terminal",
            cwd: "/repo",
            title: "pier",
          },
          {
            panelId: "shell-1",
            windowId: "w1",
            component: "terminal",
            cwd: "/repo/apps",
            title: "zsh",
          },
          {
            panelId: "git-1",
            windowId: "w1",
            component: "pier.git.changes",
            cwd: "/repo",
            worktreeKey: "/repo",
          },
          {
            panelId: "doc-1",
            windowId: "w1",
            component: "pier.files.filePanel",
            cwd: "/repo",
            sourcePath: "docs/README.md",
            sourceRoot: "/repo",
            title: "README.md",
          },
          {
            panelId: "canvas-1",
            windowId: "w1",
            component: "pier.canvas.board",
            title: "ignored",
          },
        ],
      })
    );
    expect(groups.terminals.map((row) => row.panelId)).toEqual([
      "agent-1",
      "shell-1",
    ]);
    expect(groups.terminals[0]).toMatchObject({
      agentId: "codex",
      label: "pier",
    });
    expect(groups.terminals[1]).toMatchObject({
      label: "zsh",
      statusLabel: "终端",
      agentId: null,
    });
    expect(groups.changes).toHaveLength(1);
    expect(groups.changes[0]?.label).toBe("变更 · repo");
    expect(groups.docs[0]).toMatchObject({
      label: "README.md",
      panelId: "doc-1",
      sourcePath: "docs/README.md",
      sourceRoot: "/repo",
    });
  });

  it("changes rows use gitRoot as scope; worktreeKey only as fallback", () => {
    const groups = buildProjectableGroups(
      snapshot({
        panels: [
          {
            panelId: "git-1",
            windowId: "w1",
            component: "pier.git.changes",
            cwd: "/home/me",
            gitRoot: "/repo",
            worktreeKey: "/repo",
          },
          {
            panelId: "git-legacy",
            windowId: "w1",
            component: "pier.git.changes",
            cwd: "/home/me",
            worktreeKey: "/wt-legacy",
          },
        ],
      })
    );
    expect(groups.changes[0]).toMatchObject({
      cwd: "/repo",
      worktreeKey: "/repo",
      label: "变更 · repo",
    });
    expect(groups.changes[1]).toMatchObject({
      cwd: "/wt-legacy",
      label: "变更 · wt-legacy",
    });
  });

  it("puts waiting terminals first", () => {
    const groups = buildProjectableGroups(
      snapshot({
        agents: [
          { agentId: "a", panelId: "ready-1", windowId: "w1" },
          { agentId: "b", panelId: "wait-1", windowId: "w1" },
        ],
        activity: [
          {
            kind: "agent",
            panelId: "ready-1",
            status: "ready",
            windowId: "w1",
          },
          {
            kind: "agent",
            panelId: "wait-1",
            status: "waiting",
            windowId: "w1",
            pendingInteractionId: "ix-1",
          },
        ],
        panels: [
          { panelId: "ready-1", windowId: "w1", component: "terminal" },
          { panelId: "wait-1", windowId: "w1", component: "terminal" },
        ],
      })
    );
    expect(groups.terminals.map((row) => row.panelId)).toEqual([
      "wait-1",
      "ready-1",
    ]);
    expect(groups.terminals[0]?.pendingInteractionId).toBe("ix-1");
  });

  it("uses tab short, not agentId, as the terminal row title", () => {
    const groups = buildProjectableGroups(
      snapshot({
        agents: [
          {
            agentId: "codex",
            cwd: "/repo/pier",
            panelId: "a",
            windowId: "w1",
          },
          {
            agentId: "codex",
            cwd: "/repo/feat-x",
            panelId: "b",
            windowId: "w1",
          },
          {
            agentId: "claude",
            cwd: "/repo/no-title",
            panelId: "c",
            windowId: "w1",
          },
        ],
        panels: [
          {
            component: "terminal",
            panelId: "a",
            title: "pier",
            windowId: "w1",
          },
          {
            component: "terminal",
            panelId: "b",
            title: "feat-x",
            windowId: "w1",
          },
          {
            component: "terminal",
            cwd: "/repo/no-title",
            panelId: "c",
            windowId: "w1",
          },
        ],
      })
    );
    expect(groups.terminals.map((row) => row.label)).toEqual([
      "pier",
      "feat-x",
      "no-title",
    ]);
  });

  it("falls back to cwd leaf for agents not yet in the panel list", () => {
    const groups = buildProjectableGroups(
      snapshot({
        agents: [
          {
            agentId: "codex",
            cwd: "/repo/feat-mobile",
            panelId: "orphan",
            windowId: "w1",
          },
        ],
      })
    );
    expect(groups.terminals[0]).toMatchObject({
      agentId: "codex",
      label: "feat-mobile",
      panelId: "orphan",
    });
  });

  it("keeps two windows with the same panelId as distinct rows", () => {
    const groups = buildProjectableGroups(
      snapshot({
        agents: [
          { agentId: "codex", panelId: "dup", windowId: "w1" },
          { agentId: "claude", panelId: "dup", windowId: "w2" },
        ],
        activity: [
          {
            kind: "agent",
            panelId: "dup",
            status: "ready",
            windowId: "w1",
          },
          {
            kind: "agent",
            panelId: "dup",
            pendingInteractionId: "ix-w2",
            status: "waiting",
            windowId: "w2",
          },
        ],
        panels: [
          { panelId: "dup", windowId: "w1", component: "terminal" },
          { panelId: "dup", windowId: "w2", component: "terminal" },
        ],
      })
    );
    expect(groups.terminals).toEqual([
      expect.objectContaining({
        agentId: "claude",
        panelId: "dup",
        pendingInteractionId: "ix-w2",
        windowId: "w2",
      }),
      expect.objectContaining({
        agentId: "codex",
        panelId: "dup",
        windowId: "w1",
      }),
    ]);
  });
});
