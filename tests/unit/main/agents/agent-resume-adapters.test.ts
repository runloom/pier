import { agentKindSchema } from "@shared/contracts/agent.ts";
import type { TerminalAgentPanelMetadata } from "@shared/contracts/terminal.ts";
import { describe, expect, it } from "vitest";
import {
  AGENT_RESUME_ADAPTERS,
  agentRestoreCreateFields,
  resolveAgentResumeLastLaunch,
  resolveAgentResumeLaunch,
} from "../../../../src/main/services/agents/resume-adapters.ts";

function runningAgent(
  overrides: Partial<TerminalAgentPanelMetadata> = {}
): TerminalAgentPanelMetadata {
  return {
    agentId: "claude",
    launch: {
      agentId: "claude",
      command: "claude --dangerously-skip-permissions",
      cwd: "/repo",
    },
    resume: {
      capturedAt: 1_772_000_001_000,
      sessionId: "session-123",
      source: "hook",
    },
    startedAt: 1_772_000_000_000,
    status: "running",
    ...overrides,
  };
}

describe("agent resume adapters", () => {
  it("covers every AgentKind with an explicit adapter", () => {
    expect(Object.keys(AGENT_RESUME_ADAPTERS).sort()).toEqual(
      [...agentKindSchema.options].sort()
    );
    for (const agentId of agentKindSchema.options) {
      expect(AGENT_RESUME_ADAPTERS[agentId]?.agentId).toBe(agentId);
    }
  });

  it("builds a Claude resume launch from persisted hook session id", () => {
    const resolved = resolveAgentResumeLaunch({
      agent: runningAgent(),
      cwd: "/repo",
    });

    expect(resolved.resumed).toBe(true);
    expect(resolved.launch).toEqual({
      agentId: "claude",
      command: "claude --dangerously-skip-permissions --resume session-123",
      cwd: "/repo",
    });
  });

  it("builds an omp resume launch from persisted hook session id", () => {
    const resolved = resolveAgentResumeLaunch({
      agent: runningAgent({
        agentId: "omp",
        launch: {
          agentId: "omp",
          command: "omp",
          cwd: "/repo",
        },
      }),
      cwd: "/repo",
    });

    expect(resolved.resumed).toBe(true);
    expect(resolved.launch).toEqual({
      agentId: "omp",
      command: "omp --resume session-123",
      cwd: "/repo",
    });
  });

  it("builds a Grok resume launch from persisted hook session id", () => {
    const resolved = resolveAgentResumeLaunch({
      agent: runningAgent({
        agentId: "grok",
        launch: {
          agentId: "grok",
          command: "grok --permission-mode bypassPermissions",
          cwd: "/repo",
        },
      }),
      cwd: "/repo",
    });

    expect(resolved.resumed).toBe(true);
    expect(resolved.launch).toEqual({
      agentId: "grok",
      command: "grok --permission-mode bypassPermissions --resume session-123",
      cwd: "/repo",
    });
  });

  it.each([
    {
      agentId: "cursor" as const,
      command: "cursor-agent --yolo",
      expected: "cursor-agent --yolo --resume session-123",
    },
    {
      agentId: "droid" as const,
      command: "droid",
      expected: "droid --resume session-123",
    },
    {
      agentId: "hermes" as const,
      command: "hermes",
      expected: "hermes --resume session-123",
    },
    {
      agentId: "qwen-code" as const,
      command: "qwen",
      expected: "qwen --resume session-123",
    },
    {
      agentId: "aug" as const,
      command: "auggie",
      expected: "auggie --resume session-123",
    },
    {
      agentId: "mistral-vibe" as const,
      command: "vibe",
      expected: "vibe --resume session-123",
    },
  ])("builds a $agentId resume launch with --resume <id>", ({
    agentId,
    command,
    expected,
  }) => {
    const resolved = resolveAgentResumeLaunch({
      agent: runningAgent({
        agentId,
        launch: { agentId, command, cwd: "/repo" },
      }),
      cwd: "/repo",
    });

    expect(resolved.resumed).toBe(true);
    expect(resolved.launch.command).toBe(expected);
  });

  it("builds a Kimi resume launch and strips session/continue aliases", () => {
    const resolved = resolveAgentResumeLaunch({
      agent: runningAgent({
        agentId: "kimi",
        launch: {
          agentId: "kimi",
          command: "kimi --yolo --session old --continue",
          cwd: "/repo",
        },
      }),
      cwd: "/repo",
    });

    expect(resolved.resumed).toBe(true);
    expect(resolved.launch.command).toBe("kimi --yolo --resume session-123");
  });

  it("builds a Copilot resume launch with equals-form --resume", () => {
    const resolved = resolveAgentResumeLaunch({
      agent: runningAgent({
        agentId: "copilot",
        launch: {
          agentId: "copilot",
          command: "copilot --yolo --resume=old-id",
          cwd: "/repo",
        },
      }),
      cwd: "/repo",
    });

    expect(resolved.resumed).toBe(true);
    expect(resolved.launch.command).toBe("copilot --yolo --resume=session-123");
  });

  it("builds an Antigravity resume launch with --conversation", () => {
    const resolved = resolveAgentResumeLaunch({
      agent: runningAgent({
        agentId: "antigravity",
        launch: {
          agentId: "antigravity",
          command: "agy --dangerously-skip-permissions --continue",
          cwd: "/repo",
        },
      }),
      cwd: "/repo",
    });

    expect(resolved.resumed).toBe(true);
    expect(resolved.launch.command).toBe(
      "agy --dangerously-skip-permissions --conversation session-123"
    );
  });

  it("builds a Cline resume launch with --id and keeps --cwd", () => {
    const resolved = resolveAgentResumeLaunch({
      agent: runningAgent({
        agentId: "cline",
        launch: {
          agentId: "cline",
          command: "cline --auto-approve true --cwd /repo --id old",
          cwd: "/repo",
        },
      }),
      cwd: "/repo",
    });

    expect(resolved.resumed).toBe(true);
    expect(resolved.launch.command).toBe(
      "cline --auto-approve true --cwd /repo --id session-123"
    );
  });

  it("builds a Goose resume launch via session -r --session-id", () => {
    const resolved = resolveAgentResumeLaunch({
      agent: runningAgent({
        agentId: "goose",
        launch: {
          agentId: "goose",
          command: "goose",
          cwd: "/repo",
        },
      }),
      cwd: "/repo",
    });

    expect(resolved.resumed).toBe(true);
    expect(resolved.launch.command).toBe(
      "goose session -r --session-id session-123"
    );
  });

  it("rewrites Goose session commands that already pin name or session-id", () => {
    const fromName = resolveAgentResumeLaunch({
      agent: runningAgent({
        agentId: "goose",
        launch: {
          agentId: "goose",
          command: "goose session -r -n old-name",
          cwd: "/repo",
        },
      }),
      cwd: "/repo",
    });
    const fromSessionId = resolveAgentResumeLaunch({
      agent: runningAgent({
        agentId: "goose",
        launch: {
          agentId: "goose",
          command: "goose session --resume --session-id old-id",
          cwd: "/repo",
        },
      }),
      cwd: "/repo",
    });

    expect(fromName.resumed).toBe(true);
    expect(fromName.launch.command).toBe(
      "goose session -r --session-id session-123"
    );
    expect(fromSessionId.resumed).toBe(true);
    expect(fromSessionId.launch.command).toBe(
      "goose session -r --session-id session-123"
    );
  });

  it("strips equals-form --resume when appending a space-form resume flag", () => {
    const resolved = resolveAgentResumeLaunch({
      agent: runningAgent({
        agentId: "cursor",
        launch: {
          agentId: "cursor",
          command: "cursor-agent --yolo --resume=old-chat",
          cwd: "/repo",
        },
      }),
      cwd: "/repo",
    });

    expect(resolved.resumed).toBe(true);
    expect(resolved.launch.command).toBe(
      "cursor-agent --yolo --resume session-123"
    );
  });

  it("builds Devin and command-code resume launches with --resume", () => {
    const devin = resolveAgentResumeLaunch({
      agent: runningAgent({
        agentId: "devin",
        launch: { agentId: "devin", command: "devin", cwd: "/repo" },
      }),
      cwd: "/repo",
    });
    const commandCode = resolveAgentResumeLaunch({
      agent: runningAgent({
        agentId: "command-code",
        launch: {
          agentId: "command-code",
          command: "command-code --trust",
          cwd: "/repo",
        },
      }),
      cwd: "/repo",
    });

    expect(devin.resumed).toBe(true);
    expect(devin.launch.command).toBe("devin --resume session-123");
    expect(commandCode.resumed).toBe(true);
    expect(commandCode.launch.command).toBe(
      "command-code --trust --resume session-123"
    );
  });

  it("builds a Codex resume launch without replaying a prompt", () => {
    const resolved = resolveAgentResumeLaunch({
      agent: runningAgent({
        agentId: "codex",
        launch: {
          agentId: "codex",
          command: "codex --dangerously-bypass-approvals-and-sandbox",
          cwd: "/repo",
        },
      }),
      cwd: "/repo",
    });

    expect(resolved.resumed).toBe(true);
    expect(resolved.launch).toEqual({
      agentId: "codex",
      command:
        "codex --dangerously-bypass-approvals-and-sandbox resume session-123",
      cwd: "/repo",
    });
  });

  it("builds Codex resume --last without a stored session id", () => {
    expect(
      resolveAgentResumeLastLaunch({
        agentId: "codex",
        cwd: "/repo",
        launch: {
          agentId: "codex",
          command: "codex --dangerously-bypass-approvals-and-sandbox",
          cwd: "/repo",
        },
      })
    ).toEqual({
      agentId: "codex",
      command: "codex --dangerously-bypass-approvals-and-sandbox resume --last",
      cwd: "/repo",
    });
  });

  it("builds Claude --continue for resume-last fallback", () => {
    expect(
      resolveAgentResumeLastLaunch({
        agentId: "claude",
        cwd: "/repo",
        launch: {
          agentId: "claude",
          command: "claude --dangerously-skip-permissions",
          cwd: "/repo",
        },
      })
    ).toEqual({
      agentId: "claude",
      command: "claude --dangerously-skip-permissions --continue",
      cwd: "/repo",
    });
  });

  it("returns null resume-last for unverified continue agents", () => {
    expect(
      resolveAgentResumeLastLaunch({
        agentId: "pi",
        cwd: "/repo",
        launch: { agentId: "pi", command: "pi", cwd: "/repo" },
      })
    ).toBeNull();
  });

  it("returns null resume-last when the agent has no last-session entry", () => {
    expect(
      resolveAgentResumeLastLaunch({
        agentId: "aider",
        cwd: "/repo",
        launch: { agentId: "aider", command: "aider", cwd: "/repo" },
      })
    ).toBeNull();
  });

  it("builds OpenCode-family resume launches with --session", () => {
    const resolved = resolveAgentResumeLaunch({
      agent: runningAgent({
        agentId: "opencode",
        launch: {
          agentId: "opencode",
          command: "opencode --model anthropic/claude-sonnet-4-5",
          cwd: "/repo",
        },
      }),
      cwd: "/repo",
    });

    expect(resolved.resumed).toBe(true);
    expect(resolved.launch.command).toBe(
      "opencode --model anthropic/claude-sonnet-4-5 --session session-123"
    );
  });

  it("falls back to the original launch for unsupported agents", () => {
    const agent = runningAgent({
      agentId: "aider",
      launch: {
        agentId: "aider",
        command: "aider --yes-always",
        cwd: "/repo",
      },
    });
    const resolved = resolveAgentResumeLaunch({ agent, cwd: "/repo" });

    expect(resolved.resumed).toBe(false);
    if (resolved.resumed) {
      throw new Error("expected unsupported agent fallback");
    }
    expect(resolved.reason).toBe("unsupported-agent");
    expect(resolved.launch).toEqual(agent.launch);
  });

  it("falls back to the original launch when no hook session id is available", () => {
    const { resume: _resume, ...agent } = runningAgent();
    const resolved = resolveAgentResumeLaunch({ agent, cwd: "/repo" });

    expect(resolved.resumed).toBe(false);
    if (resolved.resumed) {
      throw new Error("expected missing session id fallback");
    }
    expect(resolved.reason).toBe("missing-session-id");
    expect(resolved.launch).toEqual(agent.launch);
  });

  it("only returns tryResumeLast on cold-start for continue-capable agents", () => {
    expect(
      agentRestoreCreateFields({
        agentRestore: "resumed",
        cwd: "/repo",
        restoredAgent: runningAgent(),
      }).tryResumeLast
    ).toBeUndefined();
    const cold = agentRestoreCreateFields({
      agentRestore: "cold-start",
      cwd: "/repo",
      restoredAgent: runningAgent(),
    });
    expect(cold.agentRestore).toBe("cold-start");
    expect(cold.tryResumeLast?.command).toContain("--continue");
    expect(
      agentRestoreCreateFields({
        agentRestore: "cold-start",
        cwd: "/repo",
        restoredAgent: runningAgent({
          agentId: "omp",
          launch: { command: "omp" },
        }),
      }).tryResumeLast
    ).toBeUndefined();
  });
});
