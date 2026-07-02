import {
  detectAgentIdFromTitle,
  detectAgentStatusFromTitle,
  runtimeStatusForTitleStatus,
} from "@shared/agent-title-status.ts";
import { describe, expect, it } from "vitest";

describe("detectAgentStatusFromTitle", () => {
  it.each([
    ["✳ Summarizing repo", "idle"], // Claude Code 空闲前缀
    ["✦ generating code", "working"], // Gemini working
    ["⏲ background task", "working"], // Gemini silent working
    ["◇ gemini", "idle"], // Gemini idle
    ["✋ approve tool?", "permission"], // Gemini permission
    ["⠋ codex", "working"], // braille spinner
    ["Codex working on tests", "working"],
    ["claude thinking", "working"],
    ["task running", "working"],
    ["aider ready", "idle"],
    ["all done", "idle"],
  ] as const)("%s → %s", (title, expected) => {
    expect(detectAgentStatusFromTitle(title)).toBe(expected);
  });

  it.each([
    "", // 空
    "~/dev/my-working-copy", // 路径子串不得误报
    "networking-guide.md", // 连字符复合词不得误报
    "vim main.ts", // 普通标题
    "hardworking team notes", // 前缀粘连
  ])("误报防御: %s → null", (title) => {
    expect(detectAgentStatusFromTitle(title)).toBeNull();
  });
});

describe("runtimeStatusForTitleStatus", () => {
  it.each([
    ["working", "processing"],
    ["permission", "waiting"],
    ["idle", "ready"],
  ] as const)("%s → %s", (titleStatus, runtime) => {
    expect(runtimeStatusForTitleStatus(titleStatus)).toBe(runtime);
  });
});

describe("detectAgentIdFromTitle (标题身份识别, 启动即亮图标)", () => {
  it.each([
    ["✳ Claude Code", "claude"],
    ["✳ Claude", "claude"],
    ["◇ gemini", "gemini"],
    ["aider working on tests", "aider"],
    ["Codex working", "codex"],
    ["⠋ cursor-agent", "cursor"],
  ] as const)("%s → %s", (title, id) => {
    expect(detectAgentIdFromTitle(title)).toBe(id);
  });

  it.each([
    "✳ summarizing the repo", // 无 agent 名
    "✋ approve tool?",
    "task running",
  ])("无身份线索 → null: %s", (title) => {
    expect(detectAgentIdFromTitle(title)).toBeNull();
  });

  it("词边界防误报：路径/复合词不匹配", () => {
    expect(detectAgentIdFromTitle("✳ ~/dev/claudette-app")).toBeNull();
    expect(detectAgentIdFromTitle("✳ my-aiderish thing")).toBeNull();
  });
});
