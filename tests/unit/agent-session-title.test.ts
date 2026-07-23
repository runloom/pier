import {
  decideAgentSessionTitleWrite,
  deriveAgentSessionTitleFromPrompt,
  MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH,
  resolveAgentSessionTitle,
  truncateTerminalTitleForTooltip,
} from "@shared/agent-session-title.ts";
import { describe, expect, it } from "vitest";

describe("resolveAgentSessionTitle", () => {
  it("prefers sessionTitle over placeholder", () => {
    expect(
      resolveAgentSessionTitle({
        agentId: "claude",
        projectRootPath: "/repo/pier",
        sessionTitle: "Fix parser crash",
        sessionTitleSource: "auto",
      })
    ).toMatchObject({
      primary: "Fix parser crash",
      placeholder: "Claude · pier",
      secondary: "pier",
    });
  });

  it("builds catalog · project placeholder without sessionTitle", () => {
    expect(
      resolveAgentSessionTitle({
        agentId: "codex",
        cwd: "/Users/x/ABC/pier",
      })
    ).toEqual({
      primary: "Codex · pier",
      placeholder: "Codex · pier",
      secondary: "pier",
    });
  });

  it("uses catalog label alone when no path", () => {
    expect(
      resolveAgentSessionTitle({
        agentId: "grok",
      })
    ).toEqual({
      primary: "Grok",
      placeholder: "Grok",
    });
  });

  it("rejects multiline or overlong sessionTitle", () => {
    expect(
      resolveAgentSessionTitle({
        agentId: "claude",
        sessionTitle: "line one\nline two",
      }).primary
    ).toBe("Claude");
    expect(
      resolveAgentSessionTitle({
        agentId: "claude",
        sessionTitle: "x".repeat(41),
      }).primary
    ).toBe("Claude");
  });
});

describe("deriveAgentSessionTitleFromPrompt", () => {
  it("derives a short title and strips image placeholders", () => {
    expect(
      deriveAgentSessionTitleFromPrompt(
        "[Image #1] 帮我修一下 parser 崩溃，复现步骤很长很长"
      )
    ).toBe("帮我修一下 parser 崩溃，复现步骤很长很长");
  });

  it("returns null for greetings", () => {
    expect(deriveAgentSessionTitleFromPrompt("hi")).toBeNull();
    expect(deriveAgentSessionTitleFromPrompt("你好")).toBeNull();
  });

  it("returns null for trivial punctuation", () => {
    expect(deriveAgentSessionTitleFromPrompt("·")).toBeNull();
    expect(deriveAgentSessionTitleFromPrompt("...")).toBeNull();
  });

  it("derives the reported Chinese analyze-diff prompt", () => {
    expect(
      deriveAgentSessionTitleFromPrompt("帮我分析下当前未提交的修改")
    ).toBe("帮我分析下当前未提交的修改");
  });

  it("truncates overlong prompts", () => {
    const title = deriveAgentSessionTitleFromPrompt("a".repeat(80));
    expect(title?.length).toBe(40);
  });
});

describe("decideAgentSessionTitleWrite", () => {
  it("blocks auto when a title already exists unless replaceAuto", () => {
    expect(
      decideAgentSessionTitleWrite({
        currentSource: "auto",
        currentTitle: "Old",
        nextSource: "auto",
        nextTitle: "New",
      })
    ).toEqual({ apply: false });
    expect(
      decideAgentSessionTitleWrite({
        currentSource: "auto",
        currentTitle: "Old",
        nextSource: "auto",
        nextTitle: "New",
        replaceAuto: true,
      })
    ).toEqual({ apply: true, source: "auto", title: "New" });
  });

  it("never lets auto replace user", () => {
    expect(
      decideAgentSessionTitleWrite({
        currentSource: "user",
        currentTitle: "Mine",
        nextSource: "auto",
        nextTitle: "New",
        replaceAuto: true,
      })
    ).toEqual({ apply: false });
  });

  it("lets user overwrite auto", () => {
    expect(
      decideAgentSessionTitleWrite({
        currentSource: "auto",
        currentTitle: "Old",
        nextSource: "user",
        nextTitle: "Mine",
      })
    ).toEqual({ apply: true, source: "user", title: "Mine" });
  });
});

describe("truncateTerminalTitleForTooltip", () => {
  it("returns undefined for empty or multiline", () => {
    expect(truncateTerminalTitleForTooltip("  ")).toBeUndefined();
    expect(truncateTerminalTitleForTooltip("a\nb")).toBeUndefined();
  });

  it("truncates past the tooltip cap", () => {
    const raw = "a".repeat(MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH + 10);
    const out = truncateTerminalTitleForTooltip(raw);
    expect(out?.endsWith("…")).toBe(true);
    expect(out?.length).toBe(MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH);
  });
});
