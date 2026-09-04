/**
 * W5-S1：协作 VM — 无 one-shot 内容；needsYou 优先选中。
 */
import type { AgentRuntimeIndexEntry } from "@shared/contracts/agent/runtime-index.ts";
import { describe, expect, it } from "vitest";
import { buildCollaborationViewModel } from "@/lib/agent-runtime/collab-view-model.ts";
import { titleByWindowIdFrom } from "@/stores/window-list.store.ts";

function entry(
  partial: Partial<AgentRuntimeIndexEntry> &
    Pick<
      AgentRuntimeIndexEntry,
      "agentRef" | "agentId" | "panelId" | "windowId"
    >
): AgentRuntimeIndexEntry {
  return {
    source: "hook",
    updatedAt: 1,
    ...partial,
  };
}

describe("buildCollaborationViewModel (W5-S1)", () => {
  it("returns empty when no sessions", () => {
    const vm = buildCollaborationViewModel({
      entries: [],
      activities: [],
      currentWindowId: null,
    });
    expect(vm.empty).toBe(true);
    expect(vm.sessions).toEqual([]);
    expect(vm.selected).toBeNull();
  });

  it("E13: index agents are work role; needsYou is attention not coordinator", () => {
    const vm = buildCollaborationViewModel({
      entries: [
        entry({
          agentRef: "w\0work",
          agentId: "codex",
          panelId: "a",
          windowId: "1",
          status: "processing",
          worktreeKey: "/repo/wt",
        }),
        entry({
          agentRef: "w\0wait",
          agentId: "claude",
          panelId: "b",
          windowId: "1",
          status: "waiting",
          projectRootPath: "/repo",
        }),
      ],
      activities: [],
      currentWindowId: "1",
    });
    expect(
      vm.sessions.every((s) => s.roleKey === "agents.collab.roleWork")
    ).toBe(true);
    expect(vm.sessions.find((s) => s.agentRef === "w\0wait")?.needsYou).toBe(
      true
    );
    expect(vm.contentBoundaryKey).toBe("agents.collab.contentBoundary");
    expect(vm.selected?.agentRef).toBe("w\0wait");
    expect(vm.facts.some((f) => f.factKey === "agents.collab.factScreen")).toBe(
      true
    );
    expect(vm.facts.some((f) => f.factKey === "agents.collab.factRole")).toBe(
      true
    );
    expect(
      vm.facts.some((f) => f.factKey === "agents.collab.factWorktree")
    ).toBe(true);
  });

  it("prefers needsYou session and builds facts without one-shot fields", () => {
    const vm = buildCollaborationViewModel({
      entries: [
        entry({
          agentRef: "w\0a",
          agentId: "codex",
          panelId: "a",
          windowId: "1",
          status: "processing",
          worktreeKey: "/repo/wt",
        }),
        entry({
          agentRef: "w\0b",
          agentId: "claude",
          panelId: "b",
          windowId: "1",
          status: "waiting",
          projectRootPath: "/repo",
        }),
      ],
      activities: [
        {
          kind: "agent",
          panelId: "b",
          windowId: "1",
          agentId: "claude",
          source: "hook",
          status: "waiting",
          subagentCount: 0,
          spawnedAt: 1,
          updatedAt: 2,
        },
      ],
      currentWindowId: "1",
      notifications: [
        {
          id: "n1",
          kind: "agent.attention",
          source: "agent-attention",
          severity: "warning",
          trigger: "system-event",
          title: "需要你处理",
          body: "选择协议边界",
          read: false,
          ts: 3,
          agentRef: "w\0b",
        },
      ],
    });
    expect(vm.empty).toBe(false);
    expect(vm.selected?.agentRef).toBe("w\0b");
    expect(vm.attention?.titleKey).toBe("agents.collab.attentionTitle");
    expect(vm.attention?.agentRef).toBe("w\0b");
    expect(
      vm.facts.some((f) => f.factKey === "agents.collab.factNeedsYou")
    ).toBe(true);
    expect(
      vm.facts.some((f) => f.detailKey === "agents.collab.activityKindAgent")
    ).toBe(true);
    expect(JSON.stringify(vm)).not.toMatch(/invoke|InvocationReply|one-shot/iu);
  });

  it("aligns selection to attention notification over unrelated needsYou", () => {
    const vm = buildCollaborationViewModel({
      entries: [
        entry({
          agentRef: "w\0a",
          agentId: "codex",
          panelId: "a",
          windowId: "1",
          status: "waiting",
        }),
        entry({
          agentRef: "w\0b",
          agentId: "claude",
          panelId: "b",
          windowId: "1",
          status: "error",
        }),
      ],
      activities: [],
      currentWindowId: "1",
      notifications: [
        {
          id: "n-b",
          kind: "agent.attention",
          source: "agent-attention",
          severity: "warning",
          trigger: "system-event",
          title: "需要你处理",
          read: false,
          ts: 1,
          agentRef: "w\0b",
        },
      ],
    });
    // first needsYou is a; attention points to b — selected must follow attention
    expect(vm.selected?.agentRef).toBe("w\0b");
  });

  it("uses WindowInfo.title for other-window location, not the electron id", () => {
    const vm = buildCollaborationViewModel({
      entries: [
        entry({
          agentRef: "w\0a",
          agentId: "codex",
          panelId: "a",
          windowId: "2",
          status: "processing",
        }),
      ],
      activities: [],
      currentWindowId: "1",
      titleByWindowId: { "2": "pier · main" },
    });
    expect(vm.sessions[0]?.locationKey).toBe("agents.collab.locationWindow");
    expect(vm.sessions[0]?.locationParams).toEqual({ title: "pier · main" });
  });

  it("resolves collab location from electronWindowId when WindowInfo.id differs", () => {
    const titles = titleByWindowIdFrom([
      {
        electronWindowId: "2",
        focused: false,
        id: "w-2",
        recordId: "r-2",
        title: "pier · main",
      },
    ]);
    const vm = buildCollaborationViewModel({
      entries: [
        entry({
          agentRef: "w\0a",
          agentId: "codex",
          panelId: "a",
          windowId: "2",
          status: "processing",
        }),
      ],
      activities: [],
      currentWindowId: "1",
      titleByWindowId: titles,
    });
    expect(vm.sessions[0]?.locationParams).toEqual({ title: "pier · main" });
  });

  it("omits other-window location when a title is not yet known", () => {
    const vm = buildCollaborationViewModel({
      entries: [
        entry({
          agentRef: "w\0a",
          agentId: "codex",
          panelId: "a",
          windowId: "2",
          status: "processing",
        }),
      ],
      activities: [],
      currentWindowId: "1",
    });
    expect(vm.sessions[0]?.locationKey).toBeUndefined();
    expect(vm.sessions[0]?.locationParams).toBeUndefined();
  });

  it("marks same-window location for current window id", () => {
    const vm = buildCollaborationViewModel({
      entries: [
        entry({
          agentRef: "w\0a",
          agentId: "codex",
          panelId: "a",
          windowId: "9",
          status: "processing",
        }),
      ],
      activities: [],
      currentWindowId: "9",
    });
    expect(vm.sessions[0]?.locationKey).toBe(
      "agents.collab.locationThisWindow"
    );
  });

  it("lists session title exactly as the resolved tab short (list == tab)", () => {
    const vm = buildCollaborationViewModel({
      entries: [
        entry({
          agentRef: "w\0a",
          agentId: "claude",
          cwd: "/repo/pier",
          panelId: "a",
          sessionTitle: "Review PR",
          sessionTitleSource: "provider",
          status: "processing",
          windowId: "1",
        }),
      ],
      activities: [],
      currentWindowId: "1",
      tabShortByPanelId: { a: "feat-bug-20260823" },
    });
    expect(vm.sessions[0]?.title).toBe("feat-bug-20260823");
  });

  it("falls back to cwd basename without a tab short", () => {
    const vm = buildCollaborationViewModel({
      entries: [
        entry({
          agentRef: "w\0a",
          agentId: "claude",
          cwd: "/repo/pier",
          panelId: "a",
          sessionTitle: "Review PR",
          sessionTitleSource: "provider",
          status: "processing",
          windowId: "1",
        }),
      ],
      activities: [],
      currentWindowId: "1",
    });
    expect(vm.sessions[0]?.title).toBe("pier");
  });

  it("pairs FA facts by windowId+panelId not panelId alone", () => {
    const vm = buildCollaborationViewModel({
      entries: [
        entry({
          agentRef: "w\0a",
          agentId: "codex",
          panelId: "same",
          windowId: "2",
          status: "processing",
        }),
      ],
      activities: [
        {
          kind: "shell",
          panelId: "same",
          windowId: "1",
          spawnedAt: 1,
          updatedAt: 2,
        },
        {
          kind: "agent",
          panelId: "same",
          windowId: "2",
          agentId: "codex",
          source: "hook",
          status: "processing",
          subagentCount: 0,
          spawnedAt: 1,
          updatedAt: 2,
        },
      ],
      currentWindowId: "2",
    });
    expect(
      vm.facts.some((f) => f.detailKey === "agents.collab.activityKindAgent")
    ).toBe(true);
    expect(
      vm.facts.some((f) => f.detailKey === "agents.collab.activityKindShell")
    ).toBe(false);
  });
});
