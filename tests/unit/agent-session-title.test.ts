import {
  agentSessionTitleRank,
  decideAgentSessionTitleWrite,
  deriveAgentSessionTitleFromPrompt,
  MAX_AGENT_SESSION_TITLE_LENGTH,
  MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH,
  normalizeAgentSessionTitle,
  normalizeAgentSessionTitleSource,
  resolveAgentSessionTitle,
  stripAgentPromptMarkup,
  truncateTerminalTitleForTooltip,
} from "@shared/agent-session-title/index.ts";
import { describe, expect, it } from "vitest";

describe("resolveAgentSessionTitle", () => {
  it("prefers sessionTitle over placeholder", () => {
    expect(
      resolveAgentSessionTitle({
        agentId: "claude",
        projectRootPath: "/repo/pier",
        sessionTitle: "Fix parser crash",
        sessionTitleSource: "rule",
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

  it("rejects multiline sessionTitle and truncates overlong for display", () => {
    expect(
      resolveAgentSessionTitle({
        agentId: "claude",
        sessionTitle: "line one\nline two",
      }).primary
    ).toBe("Claude");
    const primary = resolveAgentSessionTitle({
      agentId: "claude",
      sessionTitle: "x".repeat(41),
    }).primary;
    expect(primary.length).toBe(MAX_AGENT_SESSION_TITLE_LENGTH);
    expect(primary.endsWith("…")).toBe(true);
  });

  it("strips persisted user_query markup on display", () => {
    expect(
      resolveAgentSessionTitle({
        agentId: "claude",
        sessionTitle: "<user_query> cmd + p 会先展示 loading",
        sessionTitleSource: "rule",
      }).primary
    ).toBe("cmd + p 会先展示 loading");
  });
});

describe("stripAgentPromptMarkup", () => {
  it("extracts inner user_query body and drops tags", () => {
    expect(
      stripAgentPromptMarkup(
        "<user_query>\ncmd + p 会先展示 loading\n</user_query>"
      )
    ).toBe("cmd + p 会先展示 loading");
  });

  it("strips orphan wrapper tags without a closed pair", () => {
    expect(stripAgentPromptMarkup("<user_query> 修一下 parser")).toBe(
      "修一下 parser"
    );
  });
});

describe("deriveAgentSessionTitleFromPrompt", () => {
  it("derives a short title and strips image placeholders", () => {
    // 规则层：剥图片占位 → 剥「帮我」前缀 → 在「，」处取首句。
    expect(
      deriveAgentSessionTitleFromPrompt(
        "[Image #1] 帮我修一下 parser 崩溃，复现步骤很长很长"
      )
    ).toBe("修一下 parser 崩溃");
  });

  it("returns null for greetings", () => {
    expect(deriveAgentSessionTitleFromPrompt("hi")).toBeNull();
    expect(deriveAgentSessionTitleFromPrompt("你好")).toBeNull();
    expect(deriveAgentSessionTitleFromPrompt("继续")).toBeNull();
    expect(deriveAgentSessionTitleFromPrompt("ok")).toBeNull();
  });

  it("returns null for trivial punctuation", () => {
    expect(deriveAgentSessionTitleFromPrompt("·")).toBeNull();
    expect(deriveAgentSessionTitleFromPrompt("...")).toBeNull();
  });

  it("returns null for slash commands", () => {
    expect(deriveAgentSessionTitleFromPrompt("/clear")).toBeNull();
    expect(deriveAgentSessionTitleFromPrompt("/compact now")).toBeNull();
  });

  it("returns null for pasted stack traces", () => {
    expect(
      deriveAgentSessionTitleFromPrompt(
        "TypeError: Cannot read properties of undefined (reading 'foo')"
      )
    ).toBeNull();
    expect(
      deriveAgentSessionTitleFromPrompt("    at foo (bar.ts:12:34)")
    ).toBeNull();
  });

  it("returns null for bare paths and urls", () => {
    expect(deriveAgentSessionTitleFromPrompt("src/foo/bar.ts")).toBeNull();
    expect(
      deriveAgentSessionTitleFromPrompt("https://example.com/x")
    ).toBeNull();
  });

  it("nominalizes the Chinese 'is it like' interrogative", () => {
    expect(
      deriveAgentSessionTitleFromPrompt(
        "当前项目 agent 的标题生成逻辑现在是什么样的呢"
      )
    ).toBe("项目 agent 的标题生成逻辑");
  });

  it("strips meta-language prefix and trailing modality", () => {
    expect(
      deriveAgentSessionTitleFromPrompt("帮我分析下当前未提交的修改")
    ).toBe("分析下当前未提交的修改");
  });

  it("strips user_query wrappers before deriving", () => {
    expect(
      deriveAgentSessionTitleFromPrompt(
        "<user_query>\ncmd + p 会先展示 loading spinner\n</user_query>"
      )
    ).toBe("cmd + p 会先展示 loading spinner");
  });

  it("returns null when markup-only prompt becomes empty", () => {
    expect(deriveAgentSessionTitleFromPrompt("<user_query></user_query>")).toBe(
      null
    );
  });

  it("truncates overlong prompts with an ellipsis", () => {
    const title = deriveAgentSessionTitleFromPrompt("a".repeat(80));
    expect(title?.length).toBe(MAX_AGENT_SESSION_TITLE_LENGTH);
    expect(title?.endsWith("…")).toBe(true);
  });

  it("soft-breaks near spaces when truncating", () => {
    const title = deriveAgentSessionTitleFromPrompt(
      "fix the terminal open url path when pasting images into rich input"
    );
    expect(title?.length).toBeLessThanOrEqual(MAX_AGENT_SESSION_TITLE_LENGTH);
    expect(title?.endsWith("…")).toBe(true);
    expect(title?.includes("<")).toBe(false);
  });
});

describe("normalizeAgentSessionTitle", () => {
  it("caps length with ellipsis", () => {
    const title = normalizeAgentSessionTitle("b".repeat(50));
    expect(title?.length).toBe(MAX_AGENT_SESSION_TITLE_LENGTH);
    expect(title?.endsWith("…")).toBe(true);
  });
});

describe("normalizeAgentSessionTitleSource", () => {
  it("maps legacy auto to rule", () => {
    expect(normalizeAgentSessionTitleSource("auto")).toBe("rule");
  });

  it("passes through current values", () => {
    expect(normalizeAgentSessionTitleSource("rule")).toBe("rule");
    expect(normalizeAgentSessionTitleSource("model")).toBe("model");
    expect(normalizeAgentSessionTitleSource("user")).toBe("user");
  });

  it("drops unknown values", () => {
    expect(normalizeAgentSessionTitleSource("auto-")).toBeUndefined();
    expect(normalizeAgentSessionTitleSource(undefined)).toBeUndefined();
  });
});

describe("agentSessionTitleRank", () => {
  it("orders placeholder < rule < model < user", () => {
    expect(agentSessionTitleRank(undefined)).toBe(0);
    expect(agentSessionTitleRank("rule")).toBe(1);
    expect(agentSessionTitleRank("model")).toBe(2);
    expect(agentSessionTitleRank("user")).toBe(3);
  });
});

describe("decideAgentSessionTitleWrite", () => {
  it("writes into an empty slot from any source", () => {
    expect(
      decideAgentSessionTitleWrite({
        nextSource: "rule",
        nextTitle: "First",
      })
    ).toEqual({ apply: true, source: "rule", title: "First" });
  });

  it("blocks lower-rank over higher-rank", () => {
    expect(
      decideAgentSessionTitleWrite({
        currentSource: "model",
        currentTitle: "Old",
        nextSource: "rule",
        nextTitle: "New",
      })
    ).toEqual({ apply: false });
  });

  it("allows higher-rank over lower-rank", () => {
    expect(
      decideAgentSessionTitleWrite({
        currentSource: "rule",
        currentTitle: "Old",
        nextSource: "model",
        nextTitle: "New",
      })
    ).toEqual({ apply: true, source: "model", title: "New" });
  });

  it("never lets auto-rank replace user", () => {
    expect(
      decideAgentSessionTitleWrite({
        currentSource: "user",
        currentTitle: "Mine",
        nextSource: "model",
        nextTitle: "New",
      })
    ).toEqual({ apply: false });
  });

  it("lets user overwrite anything", () => {
    expect(
      decideAgentSessionTitleWrite({
        currentSource: "model",
        currentTitle: "Old",
        nextSource: "user",
        nextTitle: "Mine",
      })
    ).toEqual({ apply: true, source: "user", title: "Mine" });
  });

  it("treats same-rank as no-op (model does not replace model)", () => {
    expect(
      decideAgentSessionTitleWrite({
        currentSource: "model",
        currentTitle: "Old",
        nextSource: "model",
        nextTitle: "New",
      })
    ).toEqual({ apply: false });
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
