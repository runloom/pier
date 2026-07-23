import type { AgentRuntimeIndexEntry } from "@shared/contracts/agent-runtime-index.ts";
import { makeAgentRef } from "@shared/contracts/agent-runtime-index.ts";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { AGENT_RUNTIME_ACTION_CONTRIBUTIONS } from "@/lib/actions/agent-runtime-actions.ts";
import { buildAgentIndexQuickPick } from "@/lib/agent-runtime/agent-index-quickpick.ts";

function entry(
  overrides: Partial<AgentRuntimeIndexEntry> &
    Pick<AgentRuntimeIndexEntry, "panelId" | "windowId"> & {
      status?: AgentRuntimeIndexEntry["status"];
    }
): AgentRuntimeIndexEntry {
  return {
    agentId: "claude",
    agentRef: makeAgentRef(overrides.windowId, overrides.panelId),
    source: "hook",
    updatedAt: 10,
    ...overrides,
  };
}

describe("buildAgentIndexQuickPick", () => {
  beforeEach(async () => {
    await initI18n();
  });

  it("groups needsYou / running / ready without embedding a focus-next row", () => {
    const model = buildAgentIndexQuickPick(
      [
        entry({
          panelId: "r",
          status: "ready",
          stateStartedAt: 1000,
          updatedAt: 1,
          windowId: "1",
        }),
        entry({
          panelId: "w",
          stateStartedAt: 1000,
          status: "waiting",
          updatedAt: 2,
          windowId: "1",
        }),
        entry({
          agentId: "codex",
          panelId: "p",
          projectRootPath: "/tmp/pier",
          stateStartedAt: 1000,
          status: "processing",
          updatedAt: 3,
          windowId: "2",
        }),
      ],
      { now: 61_000, preferredWindowId: "1" }
    );

    expect(model.sections?.map((s) => s.id)).toEqual([
      "needs-you",
      "running",
      "ready",
    ]);
    const waiting = model.sections?.[0]?.items[0];
    expect(waiting?.label).toBe("Claude");
    expect(waiting?.searchTerms).toContain("Awaiting confirmation");
    expect(waiting?.detail).toContain("This window");
    expect(model.sections?.[1]?.items[0]?.detail).toMatch(/^Window 2/);
    expect(model.sections?.[1]?.items[0]?.searchTerms).toContain("Thinking");
    expect(model.sections?.[2]?.heading).toMatch(/awaiting input/i);
  });

  it("shows projectRootPath in detail when projected", () => {
    const model = buildAgentIndexQuickPick([
      entry({
        panelId: "w",
        projectRootPath: "/Users/me/pier",
        status: "waiting",
        windowId: "1",
      }),
    ]);
    expect(model.sections?.[0]?.items[0]?.detail).toBe("/Users/me/pier");
  });

  it("omits window labels when every agent is in one window", () => {
    const model = buildAgentIndexQuickPick(
      [
        entry({
          panelId: "a",
          projectRootPath: "/tmp/a",
          status: "waiting",
          windowId: "1",
        }),
        entry({
          panelId: "b",
          projectRootPath: "/tmp/b",
          status: "processing",
          windowId: "1",
        }),
      ],
      { preferredWindowId: "1" }
    );
    expect(model.sections?.[0]?.items[0]?.detail).toBe("/tmp/a");
    expect(model.sections?.[1]?.items[0]?.detail).toBe("/tmp/b");
  });

  it("keeps window labels when agents span multiple windows", () => {
    const model = buildAgentIndexQuickPick(
      [
        entry({
          panelId: "here",
          projectRootPath: "/tmp/here",
          status: "waiting",
          windowId: "1",
        }),
        entry({
          panelId: "there",
          projectRootPath: "/tmp/there",
          status: "ready",
          windowId: "2",
        }),
      ],
      { preferredWindowId: "1" }
    );
    expect(model.sections?.[0]?.items[0]?.detail).toBe(
      "This window · /tmp/here"
    );
    expect(model.sections?.[1]?.items[0]?.detail).toBe("Window 2 · /tmp/there");
  });

  it("labels launch (no status) as Running without fabricated duration", () => {
    const model = buildAgentIndexQuickPick(
      [
        entry({
          panelId: "l",
          source: "launch",
          updatedAt: 99_000,
          windowId: "1",
        }),
      ],
      { now: 200_000 }
    );
    const item = model.sections?.[0]?.items[0];
    expect(model.sections?.[0]?.id).toBe("running");
    expect(item?.searchTerms).toContain("Running");
    expect(item?.description).toBe("Running");
  });

  it("keeps focusWaiting as shortcut-only (not a palette or list row)", () => {
    const focusWaiting = AGENT_RUNTIME_ACTION_CONTRIBUTIONS.find(
      (action) => action.id === "pier.agents.focusWaiting"
    );
    expect(focusWaiting?.surfaces).toEqual([]);
    expect(focusWaiting?.titleKey).toBe("agents.quickPick.focusNextNeedsYou");
  });

  it("supports empty new-agent action and limit", () => {
    const empty = buildAgentIndexQuickPick([], { emptyAction: "new-agent" });
    expect(empty.items?.[0]).toMatchObject({
      disabled: false,
      id: "agents:new",
    });

    const limited = buildAgentIndexQuickPick(
      [
        entry({ panelId: "a", status: "waiting", windowId: "1" }),
        entry({ panelId: "b", status: "error", windowId: "1" }),
        entry({ panelId: "c", status: "ready", windowId: "1" }),
      ],
      { limit: 2 }
    );
    const count =
      limited.sections?.reduce(
        (sum, section) => sum + section.items.length,
        0
      ) ?? 0;
    expect(count).toBe(2);
    expect(limited.sections?.map((s) => s.id)).toEqual(["needs-you"]);
  });
});
