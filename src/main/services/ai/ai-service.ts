import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import { pickAgent } from "@shared/agent-selection.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  AiStatusResult,
  AiSuggestBranchRequest,
  AiSuggestBranchResult,
} from "@shared/contracts/ai.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import { resolveOneShotInvocation } from "../agents/agent-launch.ts";
import { extractAnswerLine, supportsOneShot } from "./agent-one-shot.ts";

export interface AiService {
  status(): Promise<AiStatusResult>;
  suggestBranch(
    request: AiSuggestBranchRequest
  ): Promise<AiSuggestBranchResult>;
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
    timeoutMs: number
  ) => Promise<string>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;

function slugPrompt(text: string): string {
  return [
    "Turn this software task description (any language) into a short git branch slug.",
    "Reply with ONLY the slug on the last line of your output:",
    "2-5 lowercase English words joined by single hyphens, ASCII letters and digits only,",
    "no prefix, no quotes, no trailing punctuation, at most 32 characters.",
    "Summarize the task's intent in English.",
    `Task: ${text}`,
  ].join("\n");
}

const NON_SLUG_CHARS_RE = /[^a-z0-9]+/g;
const EDGE_DASHES_RE = /^-+|-+$/g;
const MAX_SLUG_CHARS = 32;

/** 模型输出规整为合法 slug:小写、连字符、ASCII、限长;无效则空串。 */
export function normalizeSlug(raw: string): string {
  const collapsed = raw
    .trim()
    .toLowerCase()
    .replace(NON_SLUG_CHARS_RE, "-")
    .replace(EDGE_DASHES_RE, "");
  if (!collapsed) {
    return "";
  }
  if (collapsed.length <= MAX_SLUG_CHARS) {
    return collapsed;
  }
  const truncated = collapsed.slice(0, MAX_SLUG_CHARS);
  const lastDash = truncated.lastIndexOf("-");
  // 截断落在单词中间时回退到上一个完整单词,避免 "fix-dialo" 这种残词。
  return lastDash > 0 ? truncated.slice(0, lastDash) : truncated;
}

function defaultRunOneShot(
  binary: string,
  args: readonly string[],
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      [...args],
      {
        // 在临时目录跑,避免 agent 把当前仓库当工作上下文
        cwd: tmpdir(),
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
    async status() {
      const { agent } = await resolveAgent();
      return {
        agent,
        configured: agent !== null,
        label: agent ? (getAgentCatalogEntry(agent)?.label ?? agent) : "",
      };
    },
    async suggestBranch(request) {
      const { agent, preferences } = await resolveAgent();
      if (!agent) {
        return {
          message: "no detected agent supports one-shot generation",
          reason: "not_configured",
          status: "unavailable",
        };
      }
      const invocation = resolveOneShotInvocation({
        agentId: agent,
        override: preferences.agentCommandOverrides[agent],
        agentDefaultArgs: preferences.agentDefaultArgs,
        prompt: slugPrompt(request.text),
      });
      if (!invocation) {
        return {
          message: `agent ${agent} has no one-shot command`,
          reason: "not_configured",
          status: "unavailable",
        };
      }
      let stdout: string;
      try {
        stdout = await runOneShot(
          invocation.binary,
          invocation.args,
          timeoutMs
        );
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
      const slug = normalizeSlug(extractAnswerLine(stdout));
      if (!slug) {
        return {
          message: `agent returned no usable slug: ${stdout.slice(0, 80)}`,
          reason: "invalid_response",
          status: "unavailable",
        };
      }
      return { slug, status: "ok" };
    },
  };
}
