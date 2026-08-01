import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import { describe, expect, it } from "vitest";
import { resolveLong } from "@/components/common/document-title.tsx";
import {
  activityTabChromeOverlay,
  basename,
  terminalPanelDescriptor,
} from "@/panel-kits/terminal/tab-chrome.ts";

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

  it("sets agent icon/state but does not invent a product title", () => {
    const overlay = activityTabChromeOverlay(agentActivity, {
      projectRootPath: "/Users/x/ABC/pier",
    });
    expect(overlay).toMatchObject({
      icon: { id: "agent:claude" },
      state: { status: "running" },
    });
    expect(overlay).not.toHaveProperty("title");
  });

  it("does not use provider sessionTitle as tab title", () => {
    expect(
      activityTabChromeOverlay(
        {
          ...agentActivity,
          sessionTitle: "Provider name",
          sessionTitleSource: "provider",
        },
        { projectRootPath: "/Users/x/ABC/pier" }
      )
    ).not.toHaveProperty("title");
  });

  it("applies user rename as the only product title override", () => {
    expect(
      activityTabChromeOverlay(
        {
          ...agentActivity,
          sessionTitle: "My rename",
          sessionTitleSource: "user",
        },
        { projectRootPath: "/Users/x/ABC/pier" }
      )
    ).toMatchObject({
      title: "My rename",
    });
  });

  it("falls back to persisted user rename when FA has none", () => {
    expect(
      activityTabChromeOverlay(agentActivity, {
        projectRootPath: "/Users/x/ABC/pier",
        sessionTitle: "Persisted rename",
        sessionTitleSource: "user",
      })
    ).toMatchObject({
      title: "Persisted rename",
    });
  });
});

describe("terminalPanelDescriptor Ghostty-aligned titles", () => {
  it("prefers OSC over cwd basename", () => {
    const descriptor = terminalPanelDescriptor({
      effectiveContext: undefined,
      effectiveCwd: "/Users/x/ABC/pier",
      effectiveTab: undefined,
      sessionLoaded: true,
      terminalTitle: "claude",
    });
    expect(descriptor?.display.short).toBe("claude");
    expect(descriptor?.display.long).toBe("claude");
    expect(descriptor?.display.terminalTitle).toBe("claude");
  });

  it("falls back to cwd basename when OSC is absent", () => {
    const descriptor = terminalPanelDescriptor({
      effectiveContext: undefined,
      effectiveCwd: "/Users/x/ABC/pier",
      effectiveTab: undefined,
      sessionLoaded: true,
    });
    expect(descriptor?.display.short).toBe("pier");
    expect(descriptor?.display.long).toBe("/Users/x/ABC/pier");
  });

  it("uses long OSC as primary (display cap) rather than product sessionTitle", () => {
    const longOsc =
      "[Image #3] 如图当前代码实现 tab 的内容还是路径 name , 这里是为什么呢？agent 对应的标题设置没有生效吗？ - grok more text to exceed tooltip cap intentionally for the test case padding padding";
    const descriptor = terminalPanelDescriptor({
      effectiveContext: undefined,
      effectiveCwd: "/Users/x/ABC/pier",
      effectiveTab: undefined,
      sessionLoaded: true,
      terminalTitle: longOsc,
    });
    expect(descriptor?.display.short).toBe(descriptor?.display.terminalTitle);
    expect(descriptor?.display.long).toBe(descriptor?.display.terminalTitle);
    expect((descriptor?.display.short.length ?? 0) <= 512).toBe(true);
    expect(descriptor?.display.short).not.toBe("pier");
  });

  it("lets explicit chrome title override short but keeps OSC as long", () => {
    const descriptor = terminalPanelDescriptor({
      effectiveContext: undefined,
      effectiveCwd: "/Users/x/ABC/pier",
      effectiveTab: { title: "My rename" },
      sessionLoaded: true,
      terminalTitle: "claude",
    });
    expect(descriptor?.display.short).toBe("My rename");
    expect(descriptor?.display.long).toBe("claude");
    expect(descriptor?.display.terminalTitle).toBe("claude");
  });
});
