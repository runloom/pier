/**
 * 宿主侧 AgentCaller binding 签发绑定。
 * local-control 注册成功后 bind；终端 agent 启动路径取 env 注入。
 * 未 bind 时返回 null，不阻断终端创建。
 */
import {
  PIER_AGENT_CALLER_BINDING_ENV,
  PIER_AGENT_CALLER_CREDENTIAL_FILE_ENV,
} from "@shared/contracts/local-control/agent-credential.ts";
import type {
  IssueAgentCallerCredentialArgs,
  IssuedAgentCallerCredential,
} from "./issue-credential.ts";

export type AgentCallerIssuer = (
  args?: Omit<IssueAgentCallerCredentialArgs, "store" | "bootId">
) => IssuedAgentCallerCredential;

const PARENT_BINDING_ENV_KEYS = [
  PIER_AGENT_CALLER_BINDING_ENV,
  PIER_AGENT_CALLER_CREDENTIAL_FILE_ENV,
] as const;

let issuer: AgentCallerIssuer | null = null;

export function bindAgentCallerIssuer(next: AgentCallerIssuer | null): void {
  issuer = next;
}

export function getBoundAgentCallerIssuer(): AgentCallerIssuer | null {
  return issuer;
}

/**
 * 剥离父进程残留的 binding / 旧 credential 文件路径，
 * 避免子 agent 误用父协调者身份。
 */
export function scrubAgentCallerCredentialEnv(
  env: Record<string, string>
): Record<string, string> {
  let changed = false;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if ((PARENT_BINDING_ENV_KEYS as readonly string[]).includes(key)) {
      changed = true;
      continue;
    }
    out[key] = value;
  }
  return changed ? out : env;
}

/**
 * 签发当前 boot 下的 agent binding env；失败或未 bind 返回 null。
 */
export function tryIssueAgentCallerLaunchEnv(
  args: Omit<IssueAgentCallerCredentialArgs, "store" | "bootId"> = {}
): IssuedAgentCallerCredential["env"] | null {
  if (!issuer) {
    return null;
  }
  try {
    return issuer(args).env;
  } catch (error) {
    console.warn("[agent-caller] issue binding for launch failed:", error);
    return null;
  }
}
