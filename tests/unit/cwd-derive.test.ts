import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import { describe, expect, it } from "vitest";
import { resolveLong } from "@/components/common/document-title.tsx";
import {
  activityTabChromeOverlay,
  basename,
  terminalPanelDescriptor,
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

  const grokActivity = {
    ...agentActivity,
    agentId: "grok",
  } satisfies ForegroundActivity;

  it("uses catalog · project placeholder and ignores short OSC", () => {
    expect(
      activityTabChromeOverlay(agentActivity, {
        projectRootPath: "/Users/x/ABC/pier",
      })
    ).toMatchObject({
      icon: { id: "agent:claude" },
      state: { status: "running" },
      title: "Claude · pier",
    });
  });

  it("falls back to catalog label when no project path", () => {
    expect(activityTabChromeOverlay(agentActivity)).toMatchObject({
      title: "Claude",
    });
  });

  it("ignores long Grok OSC dumps for the tab primary title", () => {
    expect(
      activityTabChromeOverlay(grokActivity, {
        projectRootPath: "/Users/x/ABC/pier",
      })
    ).toMatchObject({
      icon: { id: "agent:grok" },
      title: "Grok · pier",
    });
  });

  it("prefers FA sessionTitle when present", () => {
    expect(
      activityTabChromeOverlay(
        {
          ...agentActivity,
          sessionTitle: "Fix parser crash",
          sessionTitleSource: "auto",
        },
        { projectRootPath: "/Users/x/ABC/pier" }
      )
    ).toMatchObject({
      title: "Fix parser crash",
    });
  });

  it("falls back to persisted sessionTitle when FA has none", () => {
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

describe("terminalPanelDescriptor agent primary", () => {
  it("keeps long OSC out of display.long when displayPrimary is set", () => {
    const descriptor = terminalPanelDescriptor({
      displayPrimary: "Grok · pier",
      effectiveContext: undefined,
      effectiveCwd: "/Users/x/ABC/pier",
      effectiveTab: { title: "Grok · pier" },
      sessionLoaded: true,
      terminalTitle:
        "[Image #3] 如图当前代码实现 tab 的内容还是路径 name , 这里是为什么呢？agent 对应的标题设置没有生效吗？ - grok more text to exceed tooltip cap intentionally for the test case padding padding",
    });
    expect(descriptor?.display.short).toBe("Grok · pier");
    expect(descriptor?.display.long).toBe("Grok · pier");
    expect(descriptor?.display.terminalTitle?.includes("[Image #3]")).toBe(
      true
    );
    expect((descriptor?.display.terminalTitle?.length ?? 0) <= 120).toBe(true);
  });
});
