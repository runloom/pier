import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import { pickAgent } from "@shared/agent-selection.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
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
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;

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

/** 与 New Agent 一致:优先 defaultAgentId,否则按 AGENT_AUTO_PICK_ORDER 兜底;仅保留支持 one-shot 的。 */
function resolveOneShotAgent(
  preferences: ProjectPreferences,
  detected: readonly AgentKind[]
): AgentKind | null {
  const oneShotDetected = detected.filter((id) => supportsOneShot(id));
  return pickAgent(
    preferences.defaultAgentId,
    oneShotDetected,
    preferences.disabledAgentIds
  );
}

export function createAiService({
  detectAgents,
  readPreferences,
  runOneShot = defaultRunOneShot,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: CreateAiServiceOptions): AiService {
  async function resolveAgent(): Promise<{
    agent: AgentKind | null;
    preferences: ProjectPreferences;
  }> {
    const [preferences, detected] = await Promise.all([
      readPreferences(),
      detectAgents(),
    ]);
    return { agent: resolveOneShotAgent(preferences, detected), preferences };
  }

  return {
    async generateText(request) {
      const { agent, preferences } = await resolveAgent();
      if (!agent) {
        return {
          message: "no detected agent supports one-shot generation",
          reason: "not_configured",
          status: "unavailable",
        };
      }
      const cwd = oneShotCwd(request.projectRootPath);
      const invocation = resolveOneShotInvocation({
        agentId: agent,
        cwd,
        override: preferences.agentCommandOverrides[agent],
        agentDefaultArgs: preferences.agentDefaultArgs,
        agentPermissionMode: preferences.agentPermissionMode,
        prompt: request.prompt,
      });
      if (!invocation) {
        return {
          message: `agent ${agent} has no one-shot command`,
          reason: "not_configured",
          status: "unavailable",
        };
      }
      try {
        const text = await runOneShot(invocation.binary, invocation.args, {
          cwd,
          timeoutMs,
        });
        return { status: "ok", text };
      } catch (err) {
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
    },
    async status() {
      const { agent } = await resolveAgent();
      return {
        agent,
        configured: agent !== null,
        label: agent ? (getAgentCatalogEntry(agent)?.label ?? agent) : "",
      };
    },
  };
}
