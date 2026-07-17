import { agentKindSchema } from "@shared/contracts/agent.ts";
import type { TerminalAgentPanelMetadata } from "@shared/contracts/terminal.ts";
import { describe, expect, it } from "vitest";
import {
  AGENT_RESUME_ADAPTERS,
  resolveAgentResumeLaunch,
} from "../../../src/main/services/agents/agent-resume-adapters.ts";

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
});
