import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import { rankAgents } from "@shared/agent-selection.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  type AgentUsageState,
  EMPTY_AGENT_USAGE_STATE,
} from "@shared/contracts/agent-usage.ts";
import type {
  AiGenerateTextRequest,
  AiGenerateTextResult,
  AiStatusResult,
} from "@shared/contracts/ai.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import { resolveOneShotInvocation } from "../agents/agent-launch.ts";
import { supportsOneShot } from "./agent-one-shot.ts";

export interface AiService {
  generateText(request: AiGenerateTextRequest): Promise<AiGenerateTextResult>;
  status(): Promise<AiStatusResult>;
}

export type AgentRunFailureKind = "run_failed" | "timeout";

export class AgentRunError extends Error {
  readonly kind: AgentRunFailureKind;

  constructor(kind: AgentRunFailureKind, message: string) {
    super(message);
    this.name = "AgentRunError";
    this.kind = kind;
  }
}

export interface CreateAiServiceOptions {
  /** 已安装 agent id 列表(注入 agent-detection 的探测结果)。 */
  detectAgents: () => Promise<readonly AgentKind[]>;
  failureCooldownMs?: number;
  now?: () => number;
  readAgentUsage?: () => Promise<AgentUsageState>;
  readPreferences: () => Promise<ProjectPreferences>;
  /** 一次性运行 agent CLI,resolve stdout;失败抛 AgentRunError。 */
  runOneShot?: (
    binary: string,
    args: readonly string[],
    options: RunOneShotOptions
  ) => Promise<string>;
  timeoutMs?: number;
}

export interface RunOneShotOptions {
  cwd: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_FAILURE_COOLDOWN_MS = 5 * 60_000;
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
/** one-shot 失败后最多再试几个 agent（含首选，合计上限）。 */
const MAX_ONE_SHOT_ATTEMPTS = 3;

function oneShotCwd(projectRootPath: string | undefined): string {
  return projectRootPath?.trim() || tmpdir();
}

export function defaultRunOneShot(
  binary: string,
  args: readonly string[],
  { cwd, timeoutMs }: RunOneShotOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      binary,
      [...args],
      {
        cwd,
        env: process.env,
        maxBuffer: MAX_STDOUT_BYTES,
        timeout: timeoutMs,
      },
      (err, stdout, stderr) => {
        if (err) {
          const killed = (err as { killed?: boolean }).killed === true;
          const detail =
            stderr.trim().split("\n").slice(0, 3).join(" | ") || err.message;
          reject(
            new AgentRunError(
              killed ? "timeout" : "run_failed",
              killed ? `agent timed out after ${timeoutMs}ms` : detail
            )
          );
          return;
        }
        resolve(stdout);
      }
    );
    // Codex exec treats a piped stdin as extra prompt input and waits for EOF.
    // One-shot prompts are always passed as argv, so close stdin immediately.
    child.stdin?.end();
  });
}

function rankOneShotAgents(
  preferences: ProjectPreferences,
  detected: readonly AgentKind[],
  usage: AgentUsageState,
  now: number,
  recentSuccessAt: ReadonlyMap<AgentKind, number>
): AgentKind[] {
  return rankAgents({
    detected: detected.filter((id) => supportsOneShot(id)),
    disabled: preferences.disabledAgentIds,
    now,
    preferred: preferences.defaultAgentId,
    recentSuccessAt,
    usage: usage.entries,
  });
}

function failureResult(
  err: unknown
): Extract<AiGenerateTextResult, { status: "unavailable" }> {
  if (err instanceof AgentRunError) {
    return {
      message: err.message,
      reason: err.kind === "timeout" ? "timeout" : "request_failed",
      status: "unavailable",
    };
  }
  return {
    message: err instanceof Error ? err.message : String(err),
    reason: "request_failed",
    status: "unavailable",
  };
}

export function createAiService({
  detectAgents,
  failureCooldownMs = DEFAULT_FAILURE_COOLDOWN_MS,
  now = Date.now,
  readAgentUsage = async () => EMPTY_AGENT_USAGE_STATE,
  readPreferences,
  runOneShot = defaultRunOneShot,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: CreateAiServiceOptions): AiService {
  const cooldownUntil = new Map<AgentKind, number>();
  const recentSuccessAt = new Map<AgentKind, number>();

  async function resolveContext(): Promise<{
    agents: AgentKind[];
    preferences: ProjectPreferences;
  }> {
    const [preferences, detected, usage] = await Promise.all([
      readPreferences(),
      detectAgents(),
      readAgentUsage(),
    ]);
    const currentTime = now();
    const ranked = rankOneShotAgents(
      preferences,
      detected,
      usage,
      currentTime,
      recentSuccessAt
    );
    const ready = ranked.filter(
      (agentId) => (cooldownUntil.get(agentId) ?? 0) <= currentTime
    );
    return {
      agents: (ready.length > 0 ? ready : ranked).slice(
        0,
        MAX_ONE_SHOT_ATTEMPTS
      ),
      preferences,
    };
  }

  function recordFailure(agentId: AgentKind): void {
    cooldownUntil.set(agentId, now() + failureCooldownMs);
  }

  function recordSuccess(agentId: AgentKind): void {
    cooldownUntil.delete(agentId);
    recentSuccessAt.set(agentId, now());
  }

  return {
    async generateText(request) {
      const { agents, preferences } = await resolveContext();
      if (agents.length === 0) {
        return {
          message: "no detected agent supports one-shot generation",
          reason: "not_configured",
          status: "unavailable",
        };
      }
      const cwd = oneShotCwd(request.projectRootPath);
      let lastFailure: Extract<
        AiGenerateTextResult,
        { status: "unavailable" }
      > | null = null;

      for (const agent of agents) {
        const invocation = resolveOneShotInvocation({
          agentId: agent,
          cwd,
          override: preferences.agentCommandOverrides[agent],
          agentDefaultArgs: preferences.agentDefaultArgs,
          agentPermissionMode: preferences.agentPermissionMode,
          prompt: request.prompt,
        });
        if (!invocation) {
          lastFailure = {
            message: `agent ${agent} has no one-shot command`,
            reason: "not_configured",
            status: "unavailable",
          };
          continue;
        }
        try {
          const text = await runOneShot(invocation.binary, invocation.args, {
            cwd,
            timeoutMs,
          });
          if (text.trim().length === 0) {
            lastFailure = {
              message: `agent ${agent} returned empty output`,
              reason: "request_failed",
              status: "unavailable",
            };
            recordFailure(agent);
            continue;
          }
          recordSuccess(agent);
          return { status: "ok", text };
        } catch (err) {
          lastFailure = failureResult(err);
          recordFailure(agent);
        }
      }

      return (
        lastFailure ?? {
          message: "no detected agent supports one-shot generation",
          reason: "not_configured",
          status: "unavailable",
        }
      );
    },
    async status() {
      const { agents, preferences } = await resolveContext();
      const agent =
        preferences.defaultAgentId === "blank" ? null : (agents[0] ?? null);
      return {
        agent,
        configured: agent !== null,
        label: agent ? (getAgentCatalogEntry(agent)?.label ?? agent) : "",
      };
    },
  };
}
