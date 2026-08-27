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
    ["cursor-agent --yolo", "cursor"],
    ["cn", "continue"],
    ["agy", "antigravity"],
    ["vibe", "mistral-vibe"],
    ["kilocode", "kilo"],
    ["kimi-cli", "kimi"],
    ["kimi-cli --yolo", "kimi"],
    ["qodercli", "qodercli"],
    ["qoder", "qodercli"],
    ["qoder --yolo", "qodercli"],
    ["qoder -p hi", "qodercli"],
    ["qoder Explain this file", "qodercli"],
    ["qoder -w .", "qodercli"],
    ["qodercn", "qodercli"],
    ["qoderclicn", "qodercli"],
    ["Qoder", "qodercli"],
    ["Qoder --yolo", "qodercli"],
    ["npx qoder", "qodercli"],
    ["npx -y qoder --yolo", "qodercli"],
    ["bunx qoder", "qodercli"],
    ["pnpm dlx qoder", "qodercli"],
    ["npx qodercli", "qodercli"],
    ["vibe-acp", "mistral-vibe"],
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
    "cursor .", // 编辑器启动器，不是 cursor-agent
    "cursor",
    "cursor -w .",
    "cursor file.ts",
    "continue", // bash 内置；Continue CLI 是 cn
    "kiro .", // Kiro 编辑器启动器；智能体是 kiro-cli
    "kiro",
    "qoder .", // V1.1.18+ 合一启动器：路径参数开 IDE
    "qoder /tmp/proj",
    "qoder desktop",
    "qoder ide",
    "qoder chat",
    "qoder serve-web",
    "qoder tunnel",
    "qoder Desktop",
    "qoder file.ts",
    "qoder .gitignore",
    "qoder ../proj",
    'qoder "C:\\Users\\proj"',
    "qoder C:\\Users\\proj",
    "npx qoder .",
    "pnpm dlx qoder .",
    "bunx qoder desktop",
    "qoder ~",
    "qodercn .",
    "qodercn ide",
    "agent", // 泛名；安装探测才对 cursor-agent 做路径落地
    "agent --yolo",
    "antigravity", // 产品 id 不是可执行体（agy）
    "",
  ])("非 agent 命令 → null: %s", (commandLine) => {
    expect(matchAgentCommand(commandLine)).toBeNull();
  });

  it.each([
    "acli rovodev run",
    "acli rovodev run --profile work",
    "/opt/homebrew/bin/acli rovodev run",
    '"/Applications/Atlassian CLI/bin/acli" "rovodev" "run"',
    "ATLASSIAN_TOKEN=x acli rovodev run",
    "env ATLASSIAN_TOKEN=x acli rovodev run",
    "exec acli rovodev run",
    "sudo -u me acli rovodev run",
    "mise exec -- acli rovodev run",
  ])("Rovo 完整启动签名 → rovo: %s", (commandLine) => {
    expect(matchAgentCommand(commandLine)).toBe("rovo");
  });

  it.each([
    "acli",
    "acli jira issue list",
    "acli rovodev",
    "acli rovodev runbook",
    "/opt/homebrew/bin/acli confluence page list",
    "env ATLASSIAN_TOKEN=x acli jira issue list",
  ])("非 Rovo 的通用 acli 命令 → null: %s", (commandLine) => {
    expect(matchAgentCommand(commandLine)).toBeNull();
  });
});
