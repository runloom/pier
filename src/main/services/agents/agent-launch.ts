import { platform } from "node:os";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import { splitShellCommandWords } from "@shared/agent-command-detection.ts";
import {
  type AgentDefaultArgs,
  type AgentDefaultEnv,
  type AgentKind,
  type AgentPermissionModePreference,
  resolveEffectiveAgentDefaultArgs,
  resolveEffectiveAgentDefaultEnv,
} from "@shared/contracts/agent.ts";

export interface ResolveAgentCommandArgs {
  /** preferences.agentDefaultArgs。 */
  agentDefaultArgs: AgentDefaultArgs;
  agentId: AgentKind;
  agentPermissionMode?: AgentPermissionModePreference | undefined;
  /** terminal-profile 里的 binary 覆盖（可选）。 */
  override?: string | undefined;
}

export interface ResolveAgentLaunchArgs extends ResolveAgentCommandArgs {
  /** preferences.agentDefaultEnv。 */
  agentDefaultEnv: AgentDefaultEnv;
}

export interface ResolvedAgentLaunch {
  command: string;
  env?: Record<string, string> | undefined;
}

export interface ResolveOneShotInvocationArgs {
  agentDefaultArgs: AgentDefaultArgs;
  agentId: AgentKind;
  agentPermissionMode?: AgentPermissionModePreference | undefined;
  cwd: string;
  override?: string | undefined;
  prompt: string;
}

export interface ResolvedOneShotInvocation {
  args: string[];
  binary: string;
}

/**
 * agentId → 启动命令字符串。args 视为 shell-ready 片段直接拼接
 * （与 terminal-profile.command 同构）。未知 agent 返回 null。
 */
export function resolveAgentCommand({
  agentId,
  override,
  agentDefaultArgs,
  agentPermissionMode,
}: ResolveAgentCommandArgs): string | null {
  const entry = getAgentCatalogEntry(agentId);
  if (!entry) {
    return null;
  }
  const base =
    override?.trim() ||
    entry.launchCmdByPlatform?.[platform()] ||
    entry.launchCmd;
  const args = agentPermissionMode
    ? resolveEffectiveAgentDefaultArgs(
        agentId,
        agentDefaultArgs,
        agentPermissionMode
      )
    : (agentDefaultArgs[agentId]?.trim() ?? "");
  return args ? `${base} ${args}` : base;
}

export function resolveAgentLaunch({
  agentId,
  override,
  agentDefaultArgs,
  agentDefaultEnv,
  agentPermissionMode,
}: ResolveAgentLaunchArgs): ResolvedAgentLaunch | null {
  const command = resolveAgentCommand({
    agentId,
    override,
    agentDefaultArgs,
    ...(agentPermissionMode ? { agentPermissionMode } : {}),
  });
  if (!command) {
    return null;
  }
  const env = agentPermissionMode
    ? resolveEffectiveAgentDefaultEnv(
        agentId,
        agentDefaultEnv,
        agentPermissionMode
      )
    : (agentDefaultEnv[agentId] ?? {});
  return {
    command,
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

/** one-shot 复用 launchCmd/override/defaultArgs,再 append catalog.oneShotArgs。 */
export function resolveOneShotInvocation({
  agentId,
  cwd,
  override,
  agentDefaultArgs,
  agentPermissionMode,
  prompt,
}: ResolveOneShotInvocationArgs): ResolvedOneShotInvocation | null {
  const entry = getAgentCatalogEntry(agentId);
  if (!entry?.oneShotArgs) {
    return null;
  }
  const command = resolveAgentCommand({
    agentId,
    override,
    agentDefaultArgs,
    ...(agentPermissionMode ? { agentPermissionMode } : {}),
  });
  if (!command) {
    return null;
  }
  const words = splitShellCommandWords(command, 32);
  const binary = words[0];
  if (!binary) {
    return null;
  }
  return {
    binary,
    args: [...words.slice(1), ...entry.oneShotArgs(prompt, { cwd })],
  };
}
