import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import { describe, expect, it } from "vitest";
import { resolveLong } from "@/components/common/document-title.tsx";
import {
  activityTabChromeOverlay,
  basename,
} from "@/panel-kits/terminal/terminal-tab-chrome.ts";

describe("basename", () => {
  it('handles "/" root', () => {
    expect(basename("/")).toBe("/");
  });
  it("strips trailing slash", () => {
    expect(basename("/a/b/")).toBe("b");
  });
  it("returns last segment", () => {
    expect(basename("/Users/x/ABC/pier")).toBe("pier");
  });
  it("returns input when no slash", () => {
    expect(basename("pier")).toBe("pier");
  });
  it('fallback "Terminal" for empty input', () => {
    expect(basename("")).toBe("Terminal");
  });
});

describe("resolveLong", () => {
  it("prefers display.long over display.short", () => {
    expect(
      resolveLong({
        display: {
          long: "Claude Code",
          short: "pier",
        },
      })
    ).toBe("Claude Code");
  });

  it("falls back to display.short when no long", () => {
    expect(resolveLong({ display: { short: "x" } })).toBe("x");
  });

  it("OSC sequenceTitle 在 display.long 里时优先显示", () => {
    expect(
      resolveLong({
        display: {
          long: "Claude Code",
          short: "pier",
        },
      })
    ).toBe("Claude Code");
  });
});

describe("activityTabChromeOverlay", () => {
  const agentActivity = {
    agentId: "claude",
    kind: "agent",
    panelId: "terminal-1",
    source: "hook",
    spawnedAt: 1,
    stateStartedAt: 1,
    status: "processing",
    subagentCount: 0,
    updatedAt: 2,
    windowId: "1",
  } satisfies ForegroundActivity;

  it("uses the terminal title for agent tabs when present", () => {
    expect(
      activityTabChromeOverlay(agentActivity, "Fix parser crash")
    ).toMatchObject({
      icon: { id: "agent:claude" },
      state: { status: "running" },
      title: "Fix parser crash",
    });
  });

  it("falls back to the agent label when the terminal title is empty", () => {
    expect(activityTabChromeOverlay(agentActivity, "  ")).toMatchObject({
      title: "Claude",
    });
  });
});
