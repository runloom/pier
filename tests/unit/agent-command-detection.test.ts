import {
  commandExecutableText,
  matchAgentCommand,
} from "@shared/agent-command-detection.ts";
import { describe, expect, it } from "vitest";

describe("commandExecutableText", () => {
  it.each([
    ["codex", "codex"],
    ["codex --model gpt-5.5", "codex"],
    ["/opt/homebrew/bin/claude --help", "claude"],
    ["./codex", "codex"],
    ["OPENAI_API_KEY=x codex", "codex"],
    ["env FOO=bar claude --help", "claude"],
    ["sudo -u me claude", "claude"],
    ["exec codex", "codex"],
    ["mise exec -- codex", "codex"],
    ["mise exec node@20 -- codex", "codex"],
    ["direnv exec . aider", "aider"],
    ["uv run aider", "aider"],
    ["npx @openai/codex", "@openai/codex"],
    ["npx -y @openai/codex", "@openai/codex"],
    ["pnpm dlx @openai/codex@latest", "@openai/codex"],
    ["npm exec claude", "claude"],
    ["pipx run aider", "aider"],
    ["python -m mymodule", "mymodule"],
    ["gh copilot suggest", "gh copilot"],
    ["openai codex", "openai codex"],
    ['FOO="a b" claude', "claude"],
  ] as const)("%s → %s", (commandLine, executable) => {
    expect(commandExecutableText(commandLine)).toBe(executable);
  });

  it.each([
    "",
    "   ",
    "FOO=bar",
    "sudo",
  ])("解析不出命令 → null: %s", (commandLine) => {
    expect(commandExecutableText(commandLine)).toBeNull();
  });
});

describe("matchAgentCommand (只匹配可执行体, 不扫参数)", () => {
  it.each([
    ["codex", "codex"],
    ["codex --model gpt-5.5", "codex"],
    ["claude --dangerously-skip-permissions", "claude"],
    ["claude update", "claude"], // 子命令词不参与身份判定（omp update bug 回归 pin）
    ["omp update", "omp"],
    ["omp update --check", "omp"],
    ["OPENAI_API_KEY=x codex", "codex"],
    ["env FOO=bar claude --help", "claude"],
    ["sudo -u me claude", "claude"],
    ["/opt/homebrew/bin/codex", "codex"],
    ["npx @openai/codex", "codex"],
    ["pnpm dlx @openai/codex@latest", "codex"],
    ["mise exec -- codex", "codex"],
    ["uv run aider", "aider"],
    ["kiro-cli chat --tui", "kiro"],
    ["command-code --trust", "command-code"],
    ["gh copilot suggest", "copilot"],
    ["cursor-agent", "cursor"],
  ] as const)("%s → %s", (commandLine, agentId) => {
    expect(matchAgentCommand(commandLine)).toBe(agentId);
  });

  it.each([
    "echo codex",
    "git checkout codex/fix-login",
    "curl https://claude.ai/file",
    "ssh host claude",
    "vim ~/.codex/config.toml",
    "cat .worktrees/codex/README.md",
    "pip install x", // "pi" 词元不得命中 "pip"
    "claudette",
    "my-codex-tool",
    "compare", // "omp" 词元不得命中子串
    "romp update", // 词边界：前缀不误伤
    "",
  ])("非 agent 命令 → null: %s", (commandLine) => {
    expect(matchAgentCommand(commandLine)).toBeNull();
  });
});
